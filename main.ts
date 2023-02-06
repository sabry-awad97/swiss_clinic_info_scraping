import axios, { AxiosResponse } from 'axios';
import { load } from 'cheerio';
import * as fastCSV from 'fast-csv';
import fs from 'fs';
import { createLogger, format, transports } from 'winston';
import pLimit from 'p-limit';

const logger = createLogger({
  format: format.combine(
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    format.json()
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'clinics-ts.log' }),
  ],
});

interface IClinic {
  name: string;
  address: string;
  postcode?: string;
  city?: string;
  phone?: string;
  website?: string;
}

class Scraper {
  baseUrl: string;
  query: string;
  maxPages: number;
  concurrency: number;

  constructor(
    baseUrl: string,
    query: string,
    maxPages: number,
    concurrency = 10
  ) {
    this.baseUrl = baseUrl;
    this.query = query;
    this.maxPages = maxPages;
    this.concurrency = concurrency;
  }

  async scrapeData(): Promise<Array<IClinic>> {
    const clinics: Array<IClinic> = [];
    const promises: Array<Promise<null | AxiosResponse<string>>> = [];

    const limit = pLimit(this.concurrency);

    for (let pageNum = 1; pageNum <= this.maxPages; pageNum++) {
      const pageUrl = `${this.baseUrl}${this.query}?page=${pageNum}`;
      const pagePromise = limit(async () => {
        try {
          console.log(`Scraping page ${pageNum}`);
          const response = await axios.get(pageUrl);
          console.log(`Scraped page ${pageNum}`);
          return response;
        } catch (error) {
          logger.error(`Error retrieving data from page ${pageNum}: ${error}`);
          return null;
        }
      });

      promises.push(pagePromise);
    }

    const responses = await Promise.all(promises);

    for (const [index, response] of responses.entries()) {
      if (response == null || response.status !== 200) {
        logger.error(`Failed to retrieve data from page ${index + 1}.`);
        continue;
      }

      logger.info(`Status code for page ${index + 1}: ${response.status} .`);

      try {
        const $ = load(response.data);
        const results = $('.js-entry-card-container');

        if (!results.length) {
          logger.warn(`No results found for page ${index + 1}.`);
          continue;
        }

        results.each((i, result) => {
          const name = $(result).find('h2.card-info-title');
          const address = $(result).find('div.card-info-address');
          const telephone = $(result).find('a[href*="tel:"]');
          const website = $(result).find('a[href*="http"]');

          const clinic: IClinic = {
            name: name.text().trim(),
            address: address.text().trim(),
            postcode: address
              .text()
              .trim()
              .match(/\b\d{4}\b/)?.[0],
            city: address.text().trim().split(' ').pop(),
            phone: telephone.attr('href'),
            website: website.attr('href'),
          };

          clinics.push(clinic);
        });
      } catch (error: any) {
        logger.error(
          `An error occurred while processing page ${index + 1}: ${
            error.message
          }`
        );
      }
    }

    return clinics;
  }
}

const baseUrl = 'https://www.local.ch/en/q/';
const query = 'Switzerland/clinique';
const max_pages = 100;

const scraper = new Scraper(baseUrl, query, max_pages);

try {
  const data = await scraper.scrapeData();
  const csvStream = fastCSV.format({ headers: true });
  const writableStream = fs.createWriteStream('clinics-ts.csv');

  csvStream
    .pipe(writableStream)
    .on('error', error => logger.error(`Error writing to CSV file: ${error}`))
    .on('end', () => process.exit());

  for (const [index, record] of data.entries()) {
    if (!record.name) {
      logger.warn(
        `Record ${index}, Invalid name ${record.name} for clinic ${record.name}.`
      );
    }
    
    if (!record.address) {
      logger.warn(
        `Record ${index}, Invalid address ${record.address} for clinic ${record.name}.`
      );
    }

    if (!record.city) {
      logger.warn(
        `Record ${index}, Invalid city ${record.city} for clinic ${record.name}.`
      );
    }

    if (!/^\d{4}$/.test(record.postcode || '')) {
      logger.warn(
        `Record ${index}, Invalid postal code ${record.postcode} for clinic ${record.name}.`
      );
    }

    if (!/^tel:.*$/.test(record.phone || '')) {
      logger.warn(
        `Record ${index}, Invalid phone number ${record.phone} for clinic ${record.name}.`
      );
    }

    if (!/^http(s)?:\/\/.*$/.test(record.website || '')) {
      logger.warn(
        `Record ${index}, Invalid website URL ${record.website} for clinic ${record.name}.`
      );
    }

    csvStream.write(record);
  }

  csvStream.end();
} catch (error: any) {
  logger.error(`An error occurred while scraping data: ${error.message}`);
}

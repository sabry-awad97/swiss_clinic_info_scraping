import csv
import re
import requests
from bs4 import BeautifulSoup


class PostalCodeExtractor:
    @staticmethod
    def extract(address: str):
        postal_code = re.search(r'\b\d{4}\b', address)
        if postal_code:
            return postal_code.group()
        return None


class CityExtractor:
    @staticmethod
    def extract(address: str):
        words = address.strip().split()
        return words[-1]


class ClinicExtractor:
    @staticmethod
    def extract(result):
        name = result.find('h2', {'class': 'card-info-title'})
        address = result.find('div', {'class': 'card-info-address'})
        telephone = result.find('a', {'href': re.compile('tel')})
        website = result.find('a', {'href': re.compile('http')})

        if name is None:
            print(f"Failed to extract name from result")
            return None
        if address is None:
            print(f"Failed to extract address from result")
            return None
        if telephone is None:
            phone = None
            data_overlay_label = None
        else:
            phone = telephone.attrs.get("href", None)
            data_overlay_label = telephone.attrs.get(
                "data-overlay-label", None)
        if website is None:
            website = None
        else:
            website = website.attrs.get("href", None)

        clinic = {
            'name': name.text.strip(),
            'address': address.text.strip(),
            'postcode': PostalCodeExtractor.extract(address.text),
            'city': CityExtractor.extract(address.text),
            'phone': phone,
            'data_overlay_label': data_overlay_label,
            'website': website,
        }
        return clinic


class Scraper:
    def __init__(self, base_url: str, query: str, max_pages: int):
        self.base_url = base_url
        self.query = query
        self.max_pages = max_pages

    def scrape_data(self):
        # Initialize a list to store the data
        clinics = []
        for page_num in range(1, self.max_pages + 1):
            page_url = f'{self.base_url}{self.query}?page={page_num}'
            response = requests.get(page_url)

            # Print the status code of the response to track if the request was successful
            print(f'Status code for page {page_num}: {response.status_code}')

            if response.status_code != 200:
                # If the request was not successful
                print(f'Failed to retrieve data from page {page_num}.')
                continue

            soup = BeautifulSoup(response.text, 'html.parser')
            results = soup.find_all(
                'div', {'class': 'js-entry-card-container'})
            if not results:
                print(f"No results found for URL: {page_url}")
                continue
            for result in results:
                clinic = ClinicExtractor.extract(result)
                if clinic:
                    clinics.append(clinic)
        # Print a message to indicate that the scraping has finished
        print('Scraping completed.')
        return clinics


# Define the URL to be scraped and the number of max pages
base_url = 'https://www.local.ch/en/q/'
query = 'Switzerland/clinique'
max_pages = 100

scraper = Scraper(base_url, query, max_pages)

# Store the data in a CSV file
with open('clinics-python.csv', 'w', newline='') as csvfile:
    fieldnames = ['name', 'address', 'postcode', 'city',
                  'phone', 'data_overlay_label', 'website']
    writer = csv.DictWriter(csvfile, fieldnames=fieldnames)

    writer.writeheader()
    for clinic in scraper.scrape_data():
        writer.writerow(clinic)

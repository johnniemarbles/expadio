export interface Country {
  readonly code: string;
  readonly name: string;
  readonly dialCode: string;
  readonly defaultCurrency: string;
}

export interface State {
  readonly code: string;
  readonly name: string;
}

export interface Currency {
  readonly code: string;
  readonly name: string;
  readonly symbol: string;
}

// ISO 3166-1 alpha-2 — common countries prioritised at top
export const COUNTRIES: readonly Country[] = [
  { code: 'US', name: 'United States', dialCode: '+1', defaultCurrency: 'USD' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', defaultCurrency: 'GBP' },
  { code: 'CA', name: 'Canada', dialCode: '+1', defaultCurrency: 'CAD' },
  { code: 'AU', name: 'Australia', dialCode: '+61', defaultCurrency: 'AUD' },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', defaultCurrency: 'NZD' },
  { code: 'SG', name: 'Singapore', dialCode: '+65', defaultCurrency: 'SGD' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', defaultCurrency: 'AED' },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', defaultCurrency: 'SAR' },
  { code: 'IN', name: 'India', dialCode: '+91', defaultCurrency: 'INR' },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', defaultCurrency: 'PKR' },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', defaultCurrency: 'BDT' },
  { code: 'LK', name: 'Sri Lanka', dialCode: '+94', defaultCurrency: 'LKR' },
  { code: 'NP', name: 'Nepal', dialCode: '+977', defaultCurrency: 'NPR' },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', defaultCurrency: 'MYR' },
  { code: 'PH', name: 'Philippines', dialCode: '+63', defaultCurrency: 'PHP' },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', defaultCurrency: 'IDR' },
  { code: 'TH', name: 'Thailand', dialCode: '+66', defaultCurrency: 'THB' },
  { code: 'VN', name: 'Vietnam', dialCode: '+84', defaultCurrency: 'VND' },
  { code: 'JP', name: 'Japan', dialCode: '+81', defaultCurrency: 'JPY' },
  { code: 'KR', name: 'South Korea', dialCode: '+82', defaultCurrency: 'KRW' },
  { code: 'CN', name: 'China', dialCode: '+86', defaultCurrency: 'CNY' },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', defaultCurrency: 'HKD' },
  { code: 'TW', name: 'Taiwan', dialCode: '+886', defaultCurrency: 'TWD' },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', defaultCurrency: 'ZAR' },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', defaultCurrency: 'NGN' },
  { code: 'KE', name: 'Kenya', dialCode: '+254', defaultCurrency: 'KES' },
  { code: 'GH', name: 'Ghana', dialCode: '+233', defaultCurrency: 'GHS' },
  { code: 'EG', name: 'Egypt', dialCode: '+20', defaultCurrency: 'EGP' },
  { code: 'MA', name: 'Morocco', dialCode: '+212', defaultCurrency: 'MAD' },
  { code: 'DE', name: 'Germany', dialCode: '+49', defaultCurrency: 'EUR' },
  { code: 'FR', name: 'France', dialCode: '+33', defaultCurrency: 'EUR' },
  { code: 'IT', name: 'Italy', dialCode: '+39', defaultCurrency: 'EUR' },
  { code: 'ES', name: 'Spain', dialCode: '+34', defaultCurrency: 'EUR' },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', defaultCurrency: 'EUR' },
  { code: 'BE', name: 'Belgium', dialCode: '+32', defaultCurrency: 'EUR' },
  { code: 'PT', name: 'Portugal', dialCode: '+351', defaultCurrency: 'EUR' },
  { code: 'PL', name: 'Poland', dialCode: '+48', defaultCurrency: 'PLN' },
  { code: 'SE', name: 'Sweden', dialCode: '+46', defaultCurrency: 'SEK' },
  { code: 'NO', name: 'Norway', dialCode: '+47', defaultCurrency: 'NOK' },
  { code: 'DK', name: 'Denmark', dialCode: '+45', defaultCurrency: 'DKK' },
  { code: 'FI', name: 'Finland', dialCode: '+358', defaultCurrency: 'EUR' },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', defaultCurrency: 'CHF' },
  { code: 'AT', name: 'Austria', dialCode: '+43', defaultCurrency: 'EUR' },
  { code: 'IE', name: 'Ireland', dialCode: '+353', defaultCurrency: 'EUR' },
  { code: 'BR', name: 'Brazil', dialCode: '+55', defaultCurrency: 'BRL' },
  { code: 'MX', name: 'Mexico', dialCode: '+52', defaultCurrency: 'MXN' },
  { code: 'AR', name: 'Argentina', dialCode: '+54', defaultCurrency: 'ARS' },
  { code: 'CL', name: 'Chile', dialCode: '+56', defaultCurrency: 'CLP' },
  { code: 'CO', name: 'Colombia', dialCode: '+57', defaultCurrency: 'COP' },
  { code: 'PE', name: 'Peru', dialCode: '+51', defaultCurrency: 'PEN' },
  { code: 'QA', name: 'Qatar', dialCode: '+974', defaultCurrency: 'QAR' },
  { code: 'KW', name: 'Kuwait', dialCode: '+965', defaultCurrency: 'KWD' },
  { code: 'BH', name: 'Bahrain', dialCode: '+973', defaultCurrency: 'BHD' },
  { code: 'OM', name: 'Oman', dialCode: '+968', defaultCurrency: 'OMR' },
  { code: 'JO', name: 'Jordan', dialCode: '+962', defaultCurrency: 'JOD' },
  { code: 'LB', name: 'Lebanon', dialCode: '+961', defaultCurrency: 'LBP' },
  { code: 'IL', name: 'Israel', dialCode: '+972', defaultCurrency: 'ILS' },
  { code: 'TR', name: 'Turkey', dialCode: '+90', defaultCurrency: 'TRY' },
  { code: 'RU', name: 'Russia', dialCode: '+7', defaultCurrency: 'RUB' },
  { code: 'UA', name: 'Ukraine', dialCode: '+380', defaultCurrency: 'UAH' },
  { code: 'RO', name: 'Romania', dialCode: '+40', defaultCurrency: 'RON' },
];

// States/provinces for countries where territory selection matters
export const STATES: Readonly<Record<string, readonly State[]>> = {
  US: [
    { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
    { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
    { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
    { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
    { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
    { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
    { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
    { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
    { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
    { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
    { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
    { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
    { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
    { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
    { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
    { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
    { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'Washington D.C.' },
  ],
  CA: [
    { code: 'AB', name: 'Alberta' }, { code: 'BC', name: 'British Columbia' }, { code: 'MB', name: 'Manitoba' },
    { code: 'NB', name: 'New Brunswick' }, { code: 'NL', name: 'Newfoundland & Labrador' },
    { code: 'NS', name: 'Nova Scotia' }, { code: 'NT', name: 'Northwest Territories' },
    { code: 'NU', name: 'Nunavut' }, { code: 'ON', name: 'Ontario' }, { code: 'PE', name: 'Prince Edward Island' },
    { code: 'QC', name: 'Quebec' }, { code: 'SK', name: 'Saskatchewan' }, { code: 'YT', name: 'Yukon' },
  ],
  AU: [
    { code: 'ACT', name: 'Australian Capital Territory' }, { code: 'NSW', name: 'New South Wales' },
    { code: 'NT', name: 'Northern Territory' }, { code: 'QLD', name: 'Queensland' },
    { code: 'SA', name: 'South Australia' }, { code: 'TAS', name: 'Tasmania' },
    { code: 'VIC', name: 'Victoria' }, { code: 'WA', name: 'Western Australia' },
  ],
  NZ: [
    { code: 'AUK', name: 'Auckland' }, { code: 'BOP', name: 'Bay of Plenty' }, { code: 'CAN', name: 'Canterbury' },
    { code: 'GIS', name: 'Gisborne' }, { code: 'HKB', name: "Hawke's Bay" }, { code: 'MBH', name: 'Marlborough' },
    { code: 'MWT', name: 'Manawatu-Whanganui' }, { code: 'NSN', name: 'Nelson' }, { code: 'NTL', name: 'Northland' },
    { code: 'OTA', name: 'Otago' }, { code: 'STL', name: 'Southland' }, { code: 'TAS', name: 'Tasman' },
    { code: 'TKI', name: 'Taranaki' }, { code: 'WGN', name: 'Wellington' }, { code: 'WKO', name: 'Waikato' },
    { code: 'WTC', name: 'West Coast' },
  ],
  GB: [
    { code: 'ENG', name: 'England' }, { code: 'SCT', name: 'Scotland' },
    { code: 'WLS', name: 'Wales' }, { code: 'NIR', name: 'Northern Ireland' },
  ],
  IE: [
    { code: 'C', name: 'Cork' }, { code: 'D', name: 'Dublin' }, { code: 'G', name: 'Galway' },
    { code: 'KE', name: 'Kildare' }, { code: 'KK', name: 'Kilkenny' }, { code: 'L', name: 'Limerick' },
    { code: 'LS', name: 'Laois' }, { code: 'LH', name: 'Louth' }, { code: 'MH', name: 'Meath' },
    { code: 'T', name: 'Tipperary' }, { code: 'W', name: 'Waterford' }, { code: 'WW', name: 'Wicklow' },
  ],
  IN: [
    { code: 'AP', name: 'Andhra Pradesh' }, { code: 'AR', name: 'Arunachal Pradesh' }, { code: 'AS', name: 'Assam' },
    { code: 'BR', name: 'Bihar' }, { code: 'CG', name: 'Chhattisgarh' }, { code: 'GA', name: 'Goa' },
    { code: 'GJ', name: 'Gujarat' }, { code: 'HR', name: 'Haryana' }, { code: 'HP', name: 'Himachal Pradesh' },
    { code: 'JH', name: 'Jharkhand' }, { code: 'KA', name: 'Karnataka' }, { code: 'KL', name: 'Kerala' },
    { code: 'MP', name: 'Madhya Pradesh' }, { code: 'MH', name: 'Maharashtra' }, { code: 'MN', name: 'Manipur' },
    { code: 'ML', name: 'Meghalaya' }, { code: 'MZ', name: 'Mizoram' }, { code: 'NL', name: 'Nagaland' },
    { code: 'OD', name: 'Odisha' }, { code: 'PB', name: 'Punjab' }, { code: 'RJ', name: 'Rajasthan' },
    { code: 'SK', name: 'Sikkim' }, { code: 'TN', name: 'Tamil Nadu' }, { code: 'TS', name: 'Telangana' },
    { code: 'TR', name: 'Tripura' }, { code: 'UP', name: 'Uttar Pradesh' }, { code: 'UK', name: 'Uttarakhand' },
    { code: 'WB', name: 'West Bengal' }, { code: 'DL', name: 'Delhi' },
  ],
  ZA: [
    { code: 'EC', name: 'Eastern Cape' }, { code: 'FS', name: 'Free State' }, { code: 'GP', name: 'Gauteng' },
    { code: 'KZN', name: 'KwaZulu-Natal' }, { code: 'LP', name: 'Limpopo' }, { code: 'MP', name: 'Mpumalanga' },
    { code: 'NW', name: 'North West' }, { code: 'NC', name: 'Northern Cape' }, { code: 'WC', name: 'Western Cape' },
  ],
  BR: [
    { code: 'AC', name: 'Acre' }, { code: 'AL', name: 'Alagoas' }, { code: 'AP', name: 'Amapá' },
    { code: 'AM', name: 'Amazonas' }, { code: 'BA', name: 'Bahia' }, { code: 'CE', name: 'Ceará' },
    { code: 'DF', name: 'Distrito Federal' }, { code: 'ES', name: 'Espírito Santo' }, { code: 'GO', name: 'Goiás' },
    { code: 'MA', name: 'Maranhão' }, { code: 'MT', name: 'Mato Grosso' }, { code: 'MS', name: 'Mato Grosso do Sul' },
    { code: 'MG', name: 'Minas Gerais' }, { code: 'PA', name: 'Pará' }, { code: 'PB', name: 'Paraíba' },
    { code: 'PR', name: 'Paraná' }, { code: 'PE', name: 'Pernambuco' }, { code: 'PI', name: 'Piauí' },
    { code: 'RJ', name: 'Rio de Janeiro' }, { code: 'RN', name: 'Rio Grande do Norte' },
    { code: 'RS', name: 'Rio Grande do Sul' }, { code: 'RO', name: 'Rondônia' }, { code: 'RR', name: 'Roraima' },
    { code: 'SC', name: 'Santa Catarina' }, { code: 'SP', name: 'São Paulo' }, { code: 'SE', name: 'Sergipe' },
    { code: 'TO', name: 'Tocantins' },
  ],
  MX: [
    { code: 'AGU', name: 'Aguascalientes' }, { code: 'BCN', name: 'Baja California' },
    { code: 'BCS', name: 'Baja California Sur' }, { code: 'CAM', name: 'Campeche' },
    { code: 'CHP', name: 'Chiapas' }, { code: 'CHH', name: 'Chihuahua' }, { code: 'CMX', name: 'Mexico City' },
    { code: 'COA', name: 'Coahuila' }, { code: 'COL', name: 'Colima' }, { code: 'DUR', name: 'Durango' },
    { code: 'GUA', name: 'Guanajuato' }, { code: 'GRO', name: 'Guerrero' }, { code: 'HID', name: 'Hidalgo' },
    { code: 'JAL', name: 'Jalisco' }, { code: 'MEX', name: 'Estado de México' }, { code: 'MIC', name: 'Michoacán' },
    { code: 'MOR', name: 'Morelos' }, { code: 'NAY', name: 'Nayarit' }, { code: 'NLE', name: 'Nuevo León' },
    { code: 'OAX', name: 'Oaxaca' }, { code: 'PUE', name: 'Puebla' }, { code: 'QUE', name: 'Querétaro' },
    { code: 'ROO', name: 'Quintana Roo' }, { code: 'SLP', name: 'San Luis Potosí' }, { code: 'SIN', name: 'Sinaloa' },
    { code: 'SON', name: 'Sonora' }, { code: 'TAB', name: 'Tabasco' }, { code: 'TAM', name: 'Tamaulipas' },
    { code: 'TLA', name: 'Tlaxcala' }, { code: 'VER', name: 'Veracruz' }, { code: 'YUC', name: 'Yucatán' },
    { code: 'ZAC', name: 'Zacatecas' },
  ],
};

export const CURRENCIES: readonly Currency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QR' },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD' },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BD' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: '₨' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: '₨' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'PHP', name: 'Philippine Peso', symbol: '₱' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥' },
  { code: 'TWD', name: 'New Taiwan Dollar', symbol: 'NT$' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'MAD' },
  { code: 'PLN', name: 'Polish Zloty', symbol: 'zł' },
  { code: 'SEK', name: 'Swedish Krona', symbol: 'kr' },
  { code: 'NOK', name: 'Norwegian Krone', symbol: 'kr' },
  { code: 'DKK', name: 'Danish Krone', symbol: 'kr' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$' },
  { code: 'MXN', name: 'Mexican Peso', symbol: '$' },
  { code: 'ARS', name: 'Argentine Peso', symbol: '$' },
  { code: 'CLP', name: 'Chilean Peso', symbol: '$' },
  { code: 'COP', name: 'Colombian Peso', symbol: '$' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺' },
  { code: 'ILS', name: 'Israeli Shekel', symbol: '₪' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JD' },
];

export function getCountry(code: string): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

export function getStatesForCountry(countryCode: string): readonly State[] {
  return STATES[countryCode] ?? [];
}

export function getCurrencySymbol(currencyCode: string): string {
  return CURRENCIES.find((c) => c.code === currencyCode)?.symbol ?? currencyCode;
}

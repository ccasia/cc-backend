import IPinfoWrapper from 'node-ipinfo';

const ipinfoWrapper = new IPinfoWrapper('636b3707341cfb');

const getCountry = async (ip: string) => {
  try {
    const data = await ipinfoWrapper.lookupIp(ip);

    if (data.country) return data.country;
    return null;
  } catch (error) {
    console.log('ERROR GETTING COUNTRY', error);
    throw new Error(error);
  }
};

export default getCountry;

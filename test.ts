import https from 'https';

const options = {
  hostname: 'stg.api.fair-indonesia.com',
  path: '/api/client/analyzer',
  method: 'POST',
  headers: {
    Accept: 'application/json, text/plain, */*',
    Authorization: 'AtLrQ+Od&KKyxIr+E$4S*2nFS',
    'Content-Type': 'application/json',
    Origin: 'https://www.fair-indonesia.com',
  },
};

const data = JSON.stringify({
  identifier: 'khairulaming',
  platform: 'Instagram',
});

const req = https.request(options, (res) => {
  let responseData = '';

  res.on('data', (chunk) => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log('Response:', JSON.parse(responseData));
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

// Write data to request body
req.write(data);

// End the request
req.end();

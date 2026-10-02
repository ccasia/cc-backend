// import axios, { isAxiosError } from 'axios';

// async function main() {
//   const controller = new AbortController();

//   await new Promise<void>((resolve) =>
//     setTimeout(() => {
//       controller.abort();
//       resolve();
//     }, 3000),
//   );

//   try {
//     const res = await axios.get('https://jsonplaceholder.typicode.com/todos/1', { signal: controller.signal });
//     console.log(res.data);
//   } catch (error) {
//     if (isAxiosError(error)) {
//       console.log(error.code);
//     }
//     // console.log('Error', error);
//   }
// }

// main()
//   .then(() => console.log('Done'))
//   .catch((err) => {
//     console.log(err);
//     process.exitCode = 1;
//   });

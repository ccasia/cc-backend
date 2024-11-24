// import amqplib from 'amqplib';
// import ffmpeg from 'fluent-ffmpeg';
// import fs from 'fs';
// import paths from 'path';

// (async () => {
//   try {
//     const amqp = await amqplib.connect(process.env.RABBIT_MQ as string);
//     const channel = await amqp.createChannel();
//     await channel.assertQueue('test', { durable: true });
//     await channel.purgeQueue('test');

//     await channel.consume(
//       'test',
//       (data) => {
//         if (data !== null) {
//           const { path } = JSON.parse(data?.content.toString());

//           if (fs.existsSync(path)) {
//             // Define the output compressed video path
//             // const outputFilePath = paths.join(__dirname, 'uploads', 'compressed_' + paths.basename(path));

//             // Start FFmpeg processing
//             ffmpeg(path)
//               .output('/app/src/test.mp4')
//               .videoCodec('libx264') // Video codec for compression
//               .audioCodec('aac') // Audio codec for compression
//               .size('640x360') // Desired video resolution
//               .on('end', () => {
//                 console.log(`Compression finished for ${path}`);
//                 // Acknowledge the message
//                 // fs.unlink(path, (err) => {
//                 //   if (err) return;
//                 // });
//                 channel.ack(data);
//               })
//               .on('error', (err) => {
//                 console.error(`Error during FFmpeg processing: ${err}`);
//                 // Optionally reject the message or requeue it
//                 channel.nack(data, false, true); // Requeue message for retry
//               })
//               .run();
//           } else {
//             console.error(`File does not exist: ${path}`);
//             // Acknowledge the message even if the file doesn't exist
//             channel.ack(data);
//           }
//         }
//       },
//       {
//         noAck: false,
//       },
//     );
//   } catch (error) {
//     console.log(error);
//   }
// })();

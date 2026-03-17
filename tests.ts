const obb = { name: 'dasd', age: 123, phone: 123123123 };

for (const a of Object.entries(obb)) {
  console.log(a.at(-1));
}
console.log(performance.now());

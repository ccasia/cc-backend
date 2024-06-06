const t = [
  {
    id: 'clwxuduaj0003127fizebj95u',
    name: 'create',
    description: null,
  },
  { id: 'clwxuduau0006127f3rfj0w2s', name: 'read', description: null },
];

const a = [{ id: 'clwxuduau0006127f3rfj0w2s', name: 'read', description: null }];

console.log(t.filter((elem) => a.every((e) => e.name !== elem.name)));

const test = () => {
  console.log(this);
};

function Person(name, age) {
  this.name = name;
  this.age = age;

  return function getAge() {
    return this.age;
  };
}

test();

const person = new Person('Afiq', 21);
console.log(person.getAge);

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: "breakfast" | "lunch" | "sides" | "drinks";
  proteins?: string[];
  isSignature?: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  label: string;
  description?: string;
  items: MenuItem[];
}

export const menuData: MenuCategory[] = [
  {
    id: "breakfast",
    name: "Breakfast",
    label: "7am–11am (Mon–Fri), 12pm (Sat)",
    description: "Start your day with our hearty breakfast burritos and bowls",
    items: [
      {
        id: "breakfast-burrito",
        name: "Breakfast Burrito",
        description: "Scrambled eggs, hash browns, cheese, and your choice of protein",
        price: 7.95,
        category: "breakfast",
        proteins: ["Chorizo", "Bacon", "Sausage", "Veggie"],
        isSignature: false,
      },
      {
        id: "breakfast-bowl",
        name: "Breakfast Bowl",
        description: "Trade the tortilla for a bowl of scrambled eggs, hash browns, and toppings",
        price: 7.25,
        category: "breakfast",
        proteins: ["Chorizo", "Bacon", "Sausage"],
      },
    ],
  },
  {
    id: "lunch",
    name: "Lunch & Dinner",
    label: "11am–8pm Daily",
    description: "Fresh, made-to-order burritos and more",
    items: [
      {
        id: "signature-burrito-beef",
        name: "Signature Burrito — Ground Beef",
        description: '14" flour tortilla with ground beef, refried beans, rice, cheese, and your choice of toppings',
        price: 9.25,
        category: "lunch",
        isSignature: true,
      },
      {
        id: "signature-burrito-chicken",
        name: "Signature Burrito — Shredded Chicken",
        description: '14" flour tortilla with shredded chicken, refried beans, rice, cheese, and toppings',
        price: 9.25,
        category: "lunch",
        isSignature: true,
      },
      {
        id: "signature-burrito-barbacoa",
        name: "Signature Burrito — Barbacoa",
        description: '14" flour tortilla with slow-cooked barbacoa, refried beans, rice, cheese, and toppings',
        price: 10.75,
        category: "lunch",
        isSignature: true,
      },
      {
        id: "signature-burrito-steak",
        name: "Signature Burrito — Steak",
        description: '14" flour tortilla with grilled steak, refried beans, rice, cheese, and toppings',
        price: 10.75,
        category: "lunch",
        isSignature: true,
      },
      {
        id: "lil-pony-beef",
        name: "Lil' Pony Burrito — Ground Beef",
        description: '10" flour tortilla with ground beef, refried beans, rice, cheese, and toppings',
        price: 6.25,
        category: "lunch",
      },
      {
        id: "burrito-bowl",
        name: "Burrito Bowl",
        description: "All your favorite burrito ingredients in a bowl instead of a tortilla",
        price: 10.25,
        category: "lunch",
        proteins: ["Ground Beef", "Chicken", "Barbacoa", "Steak"],
      },
      {
        id: "quesadilla",
        name: "Quesadilla",
        description: "Grilled flour tortilla with cheese, your choice of protein, and toppings",
        price: 7.50,
        category: "lunch",
        proteins: ["Ground Beef", "Chicken", "Barbacoa", "Steak"],
      },
      {
        id: "nachos",
        name: "Nachos",
        description: "Crispy tortilla chips topped with cheese, jalapeños, sour cream, and guacamole",
        price: 10.25,
        category: "lunch",
        proteins: ["BBQ Pulled Pork", "Ground Beef", "Chicken"],
      },
    ],
  },
  {
    id: "sides",
    name: "Sides",
    label: "Available All Day",
    items: [
      {
        id: "chips-salsa",
        name: "Chips & Salsa",
        description: "Crispy tortilla chips with fresh salsa",
        price: 2.63,
        category: "sides",
      },
      {
        id: "chips-queso",
        name: "Chips & Queso",
        description: "Crispy tortilla chips with warm cheese dip",
        price: 4.68,
        category: "sides",
      },
      {
        id: "chips-guacamole",
        name: "Chips & Guacamole",
        description: "Crispy tortilla chips with fresh guacamole",
        price: 5.50,
        category: "sides",
      },
    ],
  },
  {
    id: "drinks",
    name: "Drinks",
    label: "Available All Day",
    items: [
      {
        id: "drink-small",
        name: "Soft Drink (Small)",
        description: "Coke, Sprite, Dr Pepper, and more",
        price: 2.20,
        category: "drinks",
      },
      {
        id: "drink-large",
        name: "Soft Drink (Large)",
        description: "Coke, Sprite, Dr Pepper, and more",
        price: 2.74,
        category: "drinks",
      },
      {
        id: "mexican-coke",
        name: "Mexican Coke",
        description: "Classic Coca-Cola made with cane sugar",
        price: 3.50,
        category: "drinks",
      },
      {
        id: "topo-chico",
        name: "Topo Chico",
        description: "Sparkling mineral water",
        price: 2.50,
        category: "drinks",
      },
    ],
  },
];

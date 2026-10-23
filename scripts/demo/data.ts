/**
 * Demo content: 10 restaurants with menus (Armenian + English) and 10 guests.
 * Prices are in whole dram here; the seed converts them to minor units.
 */
import type { Cuisine } from "@/shared/constants/cuisines";
import type { Allergen, DietaryTag } from "@/shared/constants/menu";

export interface DemoItem {
  hy: string;
  en: string;
  dram: number;
  descHy?: string;
  descEn?: string;
  allergens?: Allergen[];
  dietary?: DietaryTag[];
  /** One required choice, e.g. size: [hy, en, extra dram]. */
  options?: { hy: string; en: string; choices: [string, string, number][] };
}

export interface DemoRestaurant {
  key: string;
  name: string;
  description: string;
  cuisines: Cuisine[];
  priceRange: 1 | 2 | 3 | 4;
  phone: string;
  location: { name: string; address: string; city: string; lat: number; lng: number };
  /** Takes bookings (most do). */
  bookings: boolean;
  categories: { hy: string; en: string; items: DemoItem[] }[];
}

const size = (small: number, large: number): DemoItem["options"] => ({
  hy: "Չափս",
  en: "Size",
  choices: [
    ["Փոքր", "Small", small],
    ["Մեծ", "Large", large],
  ],
});

export const RESTAURANTS: DemoRestaurant[] = [
  {
    key: "ararat",
    name: "Արարատ Խորովածանոց",
    description: "Հայկական խորոված, թարմ լավաշ և տնական աղցաններ՝ Կասկադի մոտ։",
    cuisines: ["armenian", "grill"],
    priceRange: 2,
    phone: "+374 10 520 001",
    location: { name: "Կասկադ", address: "Թամանյան 3", city: "Երևան", lat: 40.1897, lng: 44.5153 },
    bookings: true,
    categories: [
      {
        hy: "Խորոված",
        en: "Barbecue",
        items: [
          {
            hy: "Խոզի խորոված",
            en: "Pork khorovats",
            dram: 4500,
            descHy: "Մարինացված խոզի միս՝ ածուխի վրա",
            descEn: "Marinated pork over charcoal",
          },
          {
            hy: "Գառան չալաղաջ",
            en: "Lamb chops",
            dram: 6500,
            descHy: "Գառան կողիկներ՝ համեմունքներով",
            descEn: "Lamb ribs with spices",
          },
          { hy: "Հավի քաբաբ", en: "Chicken kebab", dram: 3500 },
          { hy: "Բանջարեղենի խորոված", en: "Grilled vegetables", dram: 2200, dietary: ["vegan"] },
        ],
      },
      {
        hy: "Աղցաններ",
        en: "Salads",
        items: [
          { hy: "Ամառային աղցան", en: "Summer salad", dram: 1800, dietary: ["vegan"] },
          { hy: "Տաբուլե", en: "Tabbouleh", dram: 1900, allergens: ["gluten"], dietary: ["vegan"] },
          {
            hy: "Ամառային աղցան պանրով",
            en: "Salad with cheese",
            dram: 2200,
            allergens: ["milk"],
            dietary: ["vegetarian"],
          },
        ],
      },
      {
        hy: "Լավաշ և ըմպելիքներ",
        en: "Bread and drinks",
        items: [
          { hy: "Լավաշ", en: "Lavash", dram: 300, allergens: ["gluten"], dietary: ["vegan"] },
          { hy: "Թան", en: "Tan (yogurt drink)", dram: 600, allergens: ["milk"] },
          { hy: "Ջերմուկ", en: "Jermuk mineral water", dram: 700 },
          {
            hy: "Արենի գինի (բաժակ)",
            en: "Areni wine (glass)",
            dram: 2000,
            allergens: ["sulphites"],
          },
          { hy: "Հայկական սուրճ", en: "Armenian coffee", dram: 700 },
        ],
      },
    ],
  },
  {
    key: "tbilisi",
    name: "Թբիլիսյան Բակ",
    description: "Վրացական խաչապուրի, խինկալի և տաք ընկերական մթնոլորտ։",
    cuisines: ["georgian"],
    priceRange: 2,
    phone: "+374 10 520 002",
    location: {
      name: "Կենտրոն",
      address: "Պուշկինի 12",
      city: "Երևան",
      lat: 40.1834,
      lng: 44.5096,
    },
    bookings: true,
    categories: [
      {
        hy: "Տաք ուտեստներ",
        en: "Hot dishes",
        items: [
          {
            hy: "Աջարական խաչապուրի",
            en: "Adjarian khachapuri",
            dram: 3200,
            allergens: ["gluten", "milk", "eggs"],
            dietary: ["vegetarian"],
            options: size(0, 1200),
          },
          { hy: "Խինկալի (5 հատ)", en: "Khinkali (5 pcs)", dram: 2500, allergens: ["gluten"] },
          { hy: "Չաքապուլի", en: "Chakapuli", dram: 4200 },
          { hy: "Չկմերուլի", en: "Chkmeruli", dram: 3900, allergens: ["milk"] },
        ],
      },
      {
        hy: "Նախուտեստներ",
        en: "Starters",
        items: [
          { hy: "Փխալի", en: "Pkhali", dram: 1800, allergens: ["nuts"], dietary: ["vegan"] },
          {
            hy: "Բադրիջան ընկույզով",
            en: "Eggplant with walnuts",
            dram: 2000,
            allergens: ["nuts"],
            dietary: ["vegan"],
          },
          {
            hy: "Սուլուգունի",
            en: "Suluguni cheese",
            dram: 1900,
            allergens: ["milk"],
            dietary: ["vegetarian"],
          },
          { hy: "Լոբիո", en: "Lobio", dram: 1700, dietary: ["vegan"] },
        ],
      },
      {
        hy: "Ըմպելիքներ",
        en: "Drinks",
        items: [
          { hy: "Լագիձե տարխուն", en: "Lagidze tarragon", dram: 900 },
          { hy: "Սափերավի (բաժակ)", en: "Saperavi (glass)", dram: 2200, allergens: ["sulphites"] },
          { hy: "Բորժոմի", en: "Borjomi", dram: 900 },
        ],
      },
    ],
  },
  {
    key: "napoli",
    name: "Նապոլի Պիցցերիա",
    description: "Կրակի վառարանում թխված նեապոլիտանական պիցցա և տնական մակարոնեղեն։",
    cuisines: ["italian", "pizza"],
    priceRange: 2,
    phone: "+374 10 520 003",
    location: { name: "Աբովյան", address: "Աբովյան 24", city: "Երևան", lat: 40.1853, lng: 44.5194 },
    bookings: true,
    categories: [
      {
        hy: "Պիցցա",
        en: "Pizza",
        items: [
          {
            hy: "Մարգարիտա",
            en: "Margherita",
            dram: 3200,
            allergens: ["gluten", "milk"],
            dietary: ["vegetarian"],
            options: size(0, 1500),
          },
          {
            hy: "Պեպերոնի",
            en: "Pepperoni",
            dram: 3800,
            allergens: ["gluten", "milk"],
            dietary: ["spicy"],
            options: size(0, 1500),
          },
          {
            hy: "Քառը պանիր",
            en: "Quattro formaggi",
            dram: 4200,
            allergens: ["gluten", "milk"],
            dietary: ["vegetarian"],
            options: size(0, 1500),
          },
          {
            hy: "Դիավոլա",
            en: "Diavola",
            dram: 4000,
            allergens: ["gluten", "milk"],
            dietary: ["spicy"],
            options: size(0, 1500),
          },
        ],
      },
      {
        hy: "Մակարոնեղեն",
        en: "Pasta",
        items: [
          { hy: "Կարբոնարա", en: "Carbonara", dram: 3600, allergens: ["gluten", "eggs", "milk"] },
          { hy: "Բոլոնեզ", en: "Bolognese", dram: 3500, allergens: ["gluten", "celery"] },
          {
            hy: "Պեստո",
            en: "Pesto pasta",
            dram: 3300,
            allergens: ["gluten", "nuts", "milk"],
            dietary: ["vegetarian"],
          },
        ],
      },
      {
        hy: "Աղանդեր և ըմպելիքներ",
        en: "Desserts and drinks",
        items: [
          { hy: "Տիրամիսու", en: "Tiramisu", dram: 2200, allergens: ["gluten", "eggs", "milk"] },
          { hy: "Պաննա կոտա", en: "Panna cotta", dram: 1900, allergens: ["milk"] },
          { hy: "Լիմոնադ", en: "Lemonade", dram: 1000 },
          { hy: "Էսպրեսո", en: "Espresso", dram: 800 },
        ],
      },
    ],
  },
  {
    key: "sakura",
    name: "Սակուրա Սուշի",
    description: "Ճապոնական սուշի, ռոլլեր և ռամեն՝ թարմ ձկով ամեն օր։",
    cuisines: ["japanese", "asian", "seafood"],
    priceRange: 3,
    phone: "+374 10 520 004",
    location: {
      name: "Հյուսիսային պողոտա",
      address: "Հյուսիսային պողոտա 5",
      city: "Երևան",
      lat: 40.1823,
      lng: 44.5137,
    },
    bookings: true,
    categories: [
      {
        hy: "Ռոլլեր",
        en: "Rolls",
        items: [
          {
            hy: "Ֆիլադելֆիա",
            en: "Philadelphia roll",
            dram: 4800,
            allergens: ["fish", "milk", "sesame"],
          },
          {
            hy: "Կալիֆորնիա",
            en: "California roll",
            dram: 4200,
            allergens: ["crustaceans", "sesame", "eggs"],
          },
          {
            hy: "Վեգան ռոլլ",
            en: "Veggie roll",
            dram: 3000,
            allergens: ["sesame", "soybeans"],
            dietary: ["vegan"],
          },
          {
            hy: "Կրակոտ թունա",
            en: "Spicy tuna roll",
            dram: 5200,
            allergens: ["fish", "sesame"],
            dietary: ["spicy"],
          },
        ],
      },
      {
        hy: "Տաք ուտեստներ",
        en: "Hot dishes",
        items: [
          {
            hy: "Ռամեն հավով",
            en: "Chicken ramen",
            dram: 3800,
            allergens: ["gluten", "eggs", "soybeans"],
          },
          {
            hy: "Մակարոն յակիսոբա",
            en: "Yakisoba noodles",
            dram: 3400,
            allergens: ["gluten", "soybeans"],
          },
          { hy: "Միսո ապուր", en: "Miso soup", dram: 1600, allergens: ["soybeans", "fish"] },
          { hy: "Էդամամե", en: "Edamame", dram: 1500, allergens: ["soybeans"], dietary: ["vegan"] },
        ],
      },
      {
        hy: "Ըմպելիքներ",
        en: "Drinks",
        items: [
          { hy: "Կանաչ թեյ", en: "Green tea", dram: 900 },
          { hy: "Մատչա լատտե", en: "Matcha latte", dram: 1600, allergens: ["milk"] },
          { hy: "Սակե", en: "Sake", dram: 2500 },
        ],
      },
    ],
  },
  {
    key: "lavash-cafe",
    name: "Լավաշ Սրճարան",
    description: "Նախաճաշեր, թարմ թխվածքներ և լավագույն սուրճը Գյումրիում։",
    cuisines: ["cafe", "coffee", "bakery"],
    priceRange: 1,
    phone: "+374 312 520 05",
    location: {
      name: "Վարդանանց հրապարակ",
      address: "Աբովյան 8",
      city: "Գյումրի",
      lat: 40.7894,
      lng: 43.8475,
    },
    bookings: false,
    categories: [
      {
        hy: "Նախաճաշ",
        en: "Breakfast",
        items: [
          {
            hy: "Ձվածեղ բանջարեղենով",
            en: "Omelette with vegetables",
            dram: 1800,
            allergens: ["eggs", "milk"],
            dietary: ["vegetarian"],
          },
          {
            hy: "Պանրով գաթա",
            en: "Cheese pastry",
            dram: 900,
            allergens: ["gluten", "milk", "eggs"],
            dietary: ["vegetarian"],
          },
          {
            hy: "Վարսակի շիլա",
            en: "Oat porridge",
            dram: 1400,
            allergens: ["gluten", "milk"],
            dietary: ["vegetarian"],
          },
          {
            hy: "Ավոկադոյով տոստ",
            en: "Avocado toast",
            dram: 2200,
            allergens: ["gluten"],
            dietary: ["vegan"],
          },
        ],
      },
      {
        hy: "Թխվածք",
        en: "Pastries",
        items: [
          { hy: "Գաթա", en: "Gata", dram: 700, allergens: ["gluten", "milk", "eggs"] },
          { hy: "Կրուասան", en: "Croissant", dram: 800, allergens: ["gluten", "milk"] },
          {
            hy: "Նապոլեոն",
            en: "Napoleon cake",
            dram: 1200,
            allergens: ["gluten", "milk", "eggs"],
          },
        ],
      },
      {
        hy: "Սուրճ և թեյ",
        en: "Coffee and tea",
        items: [
          {
            hy: "Կապուչինո",
            en: "Cappuccino",
            dram: 1100,
            allergens: ["milk"],
            options: size(0, 300),
          },
          { hy: "Լատտե", en: "Latte", dram: 1200, allergens: ["milk"], options: size(0, 300) },
          { hy: "Ամերիկանո", en: "Americano", dram: 900 },
          { hy: "Ուրցով թեյ", en: "Thyme tea", dram: 700 },
        ],
      },
    ],
  },
  {
    key: "dilijan-forest",
    name: "Դիլիջան Անտառ",
    description: "Եվրոպական խոհանոց անտառի տեսարանով՝ բուխարիի մոտ։",
    cuisines: ["european", "wine"],
    priceRange: 3,
    phone: "+374 268 520 06",
    location: {
      name: "Շարամբեյան",
      address: "Շարամբեյան 14",
      city: "Դիլիջան",
      lat: 40.7406,
      lng: 44.8636,
    },
    bookings: true,
    categories: [
      {
        hy: "Հիմնական ուտեստներ",
        en: "Mains",
        items: [
          { hy: "Իշխան տապակած", en: "Pan-fried trout", dram: 6200, allergens: ["fish", "milk"] },
          {
            hy: "Տավարի սթեյք",
            en: "Beef steak",
            dram: 9500,
            options: {
              hy: "Եփվածություն",
              en: "Doneness",
              choices: [
                ["Միջին", "Medium", 0],
                ["Լավ եփված", "Well done", 0],
              ],
            },
          },
          {
            hy: "Սնկով ռիզոտո",
            en: "Mushroom risotto",
            dram: 4800,
            allergens: ["milk"],
            dietary: ["vegetarian"],
          },
          { hy: "Բադի կրծքամիս", en: "Duck breast", dram: 7800 },
        ],
      },
      {
        hy: "Նախուտեստներ",
        en: "Starters",
        items: [
          {
            hy: "Կրեմ-ապուր սնկով",
            en: "Mushroom cream soup",
            dram: 2400,
            allergens: ["milk"],
            dietary: ["vegetarian"],
          },
          {
            hy: "Բուրատա",
            en: "Burrata",
            dram: 4200,
            allergens: ["milk"],
            dietary: ["vegetarian"],
          },
          { hy: "Պանրի ափսե", en: "Cheese plate", dram: 5500, allergens: ["milk", "nuts"] },
        ],
      },
      {
        hy: "Գինի",
        en: "Wine",
        items: [
          {
            hy: "Արենի նոյր (բաժակ)",
            en: "Areni noir (glass)",
            dram: 2800,
            allergens: ["sulphites"],
          },
          { hy: "Ոսկեհատ (բաժակ)", en: "Voskehat (glass)", dram: 2600, allergens: ["sulphites"] },
          { hy: "Արենի (շիշ)", en: "Areni (bottle)", dram: 14000, allergens: ["sulphites"] },
        ],
      },
    ],
  },
  {
    key: "burger-lab",
    name: "Բուրգեր Լաբ",
    description: "Ձեռքով պատրաստված բուրգերներ, տապակած կարտոֆիլ և կոկտեյլներ։",
    cuisines: ["burgers", "american", "fast_food"],
    priceRange: 2,
    phone: "+374 10 520 007",
    location: {
      name: "Կոմիտաս",
      address: "Կոմիտասի 35",
      city: "Երևան",
      lat: 40.2052,
      lng: 44.5114,
    },
    bookings: false,
    categories: [
      {
        hy: "Բուրգերներ",
        en: "Burgers",
        items: [
          {
            hy: "Դասական բուրգեր",
            en: "Classic burger",
            dram: 3200,
            allergens: ["gluten", "milk", "sesame"],
            options: {
              hy: "Կոտլետ",
              en: "Patty",
              choices: [
                ["Մեկ", "Single", 0],
                ["Կրկնակի", "Double", 1400],
              ],
            },
          },
          {
            hy: "Չիզբուրգեր",
            en: "Cheeseburger",
            dram: 3500,
            allergens: ["gluten", "milk", "sesame"],
          },
          {
            hy: "Կծու բուրգեր",
            en: "Spicy burger",
            dram: 3700,
            allergens: ["gluten", "milk"],
            dietary: ["spicy"],
          },
          {
            hy: "Վեգան բուրգեր",
            en: "Vegan burger",
            dram: 3400,
            allergens: ["gluten", "soybeans"],
            dietary: ["vegan"],
          },
        ],
      },
      {
        hy: "Կողմնակի",
        en: "Sides",
        items: [
          { hy: "Ֆրի", en: "Fries", dram: 1100, dietary: ["vegan"] },
          { hy: "Սոխի օղակներ", en: "Onion rings", dram: 1300, allergens: ["gluten"] },
          { hy: "Հավի թևիկներ", en: "Chicken wings", dram: 2800, dietary: ["spicy"] },
        ],
      },
      {
        hy: "Ըմպելիքներ",
        en: "Drinks",
        items: [
          { hy: "Վանիլային կոկտեյլ", en: "Vanilla milkshake", dram: 1600, allergens: ["milk"] },
          { hy: "Շոկոլադե կոկտեյլ", en: "Chocolate milkshake", dram: 1700, allergens: ["milk"] },
          { hy: "Կոլա", en: "Cola", dram: 700 },
        ],
      },
    ],
  },
  {
    key: "beirut",
    name: "Բեյրութ Լանչ",
    description: "Լիբանանյան մեզե, ֆալաֆել և շաուրմա՝ արագ և համեղ։",
    cuisines: ["middle_eastern", "vegetarian"],
    priceRange: 1,
    phone: "+374 10 520 008",
    location: { name: "Մաշտոց", address: "Մաշտոցի 18", city: "Երևան", lat: 40.1859, lng: 44.5081 },
    bookings: true,
    categories: [
      {
        hy: "Մեզե",
        en: "Mezze",
        items: [
          { hy: "Հումուս", en: "Hummus", dram: 1500, allergens: ["sesame"], dietary: ["vegan"] },
          { hy: "Մուտաբալ", en: "Moutabal", dram: 1600, allergens: ["sesame"], dietary: ["vegan"] },
          { hy: "Ֆաթուշ", en: "Fattoush", dram: 1800, allergens: ["gluten"], dietary: ["vegan"] },
          {
            hy: "Ֆալաֆել (6 հատ)",
            en: "Falafel (6 pcs)",
            dram: 1700,
            allergens: ["sesame"],
            dietary: ["vegan"],
          },
        ],
      },
      {
        hy: "Շաուրմա",
        en: "Shawarma",
        items: [
          {
            hy: "Հավի շաուրմա",
            en: "Chicken shawarma",
            dram: 1900,
            allergens: ["gluten", "sesame"],
            dietary: ["halal"],
          },
          {
            hy: "Տավարի շաուրմա",
            en: "Beef shawarma",
            dram: 2300,
            allergens: ["gluten", "sesame"],
            dietary: ["halal"],
          },
          {
            hy: "Ֆալաֆել լավաշում",
            en: "Falafel wrap",
            dram: 1600,
            allergens: ["gluten", "sesame"],
            dietary: ["vegan"],
          },
        ],
      },
      {
        hy: "Քաղցր և ըմպելիքներ",
        en: "Sweets and drinks",
        items: [
          { hy: "Բաքլավա", en: "Baklava", dram: 1200, allergens: ["gluten", "nuts"] },
          { hy: "Այրան", en: "Ayran", dram: 600, allergens: ["milk"] },
          { hy: "Թարմ նարինջ", en: "Fresh orange juice", dram: 1300 },
        ],
      },
    ],
  },
  {
    key: "sevan-fish",
    name: "Սևան Ձկնատուն",
    description: "Սևանի իշխան և կարմրախայտ՝ լճի ափին, ամառային տեռասով։",
    cuisines: ["seafood", "armenian", "grill"],
    priceRange: 3,
    phone: "+374 261 520 09",
    location: {
      name: "Լճափ",
      address: "Սևանի թերակղզի 1",
      city: "Սևան",
      lat: 40.5636,
      lng: 45.0119,
    },
    bookings: true,
    categories: [
      {
        hy: "Ձուկ",
        en: "Fish",
        items: [
          { hy: "Իշխան խորոված", en: "Grilled ishkhan trout", dram: 7500, allergens: ["fish"] },
          {
            hy: "Կարմրախայտ տապակած",
            en: "Fried rainbow trout",
            dram: 6000,
            allergens: ["fish", "gluten"],
          },
          { hy: "Սիգ թոնիրում", en: "Whitefish from the tonir", dram: 5500, allergens: ["fish"] },
          { hy: "Ձկան ապուր", en: "Fish soup", dram: 2800, allergens: ["fish", "celery"] },
        ],
      },
      {
        hy: "Կողմնակի",
        en: "Sides",
        items: [
          { hy: "Կարտոֆիլ խորոված", en: "Grilled potatoes", dram: 1200, dietary: ["vegan"] },
          { hy: "Կանաչի ափսե", en: "Fresh herbs plate", dram: 1000, dietary: ["vegan"] },
          { hy: "Լավաշ", en: "Lavash", dram: 300, allergens: ["gluten"], dietary: ["vegan"] },
        ],
      },
      {
        hy: "Ըմպելիքներ",
        en: "Drinks",
        items: [
          { hy: "Կոմպոտ", en: "Compote", dram: 900 },
          { hy: "Կիլիկիա գարեջուր", en: "Kilikia beer", dram: 1200, allergens: ["gluten"] },
          { hy: "Ծիրանի օղի (50 մլ)", en: "Apricot vodka (50 ml)", dram: 1500 },
        ],
      },
    ],
  },
  {
    key: "green-bowl",
    name: "Կանաչ Ամանակ",
    description: "Բուսական բոուլներ, սմուզիներ և առողջ աղանդեր։",
    cuisines: ["vegetarian", "cafe"],
    priceRange: 2,
    phone: "+374 10 520 010",
    location: { name: "Արաբկիր", address: "Կոմիտասի 7", city: "Երևան", lat: 40.2016, lng: 44.5038 },
    bookings: false,
    categories: [
      {
        hy: "Բոուլներ",
        en: "Bowls",
        items: [
          {
            hy: "Կինոա բոուլ",
            en: "Quinoa bowl",
            dram: 3200,
            allergens: ["sesame"],
            dietary: ["vegan"],
          },
          {
            hy: "Ֆալաֆել բոուլ",
            en: "Falafel bowl",
            dram: 3000,
            allergens: ["sesame"],
            dietary: ["vegan"],
          },
          { hy: "Հավով բոուլ", en: "Chicken bowl", dram: 3400 },
          {
            hy: "Ասիական թոֆու",
            en: "Asian tofu bowl",
            dram: 3100,
            allergens: ["soybeans", "sesame"],
            dietary: ["vegan", "spicy"],
          },
        ],
      },
      {
        hy: "Սմուզիներ",
        en: "Smoothies",
        items: [
          { hy: "Կանաչ սմուզի", en: "Green smoothie", dram: 1500, dietary: ["vegan"] },
          { hy: "Հատապտղային սմուզի", en: "Berry smoothie", dram: 1600, dietary: ["vegan"] },
          {
            hy: "Բանան և գետնանուշ",
            en: "Banana peanut smoothie",
            dram: 1700,
            allergens: ["peanuts"],
            dietary: ["vegan"],
          },
        ],
      },
      {
        hy: "Աղանդեր",
        en: "Desserts",
        items: [
          { hy: "Չիա պուդինգ", en: "Chia pudding", dram: 1400, dietary: ["vegan"] },
          {
            hy: "Վեգան բրաունի",
            en: "Vegan brownie",
            dram: 1300,
            allergens: ["gluten", "nuts"],
            dietary: ["vegan"],
          },
          { hy: "Մրգային ափսե", en: "Fruit plate", dram: 1800, dietary: ["vegan"] },
        ],
      },
    ],
  },
];

/** Demo guests (all share the demo password). */
export const CUSTOMERS = [
  { key: "anna", name: "Աննա Հակոբյան", phone: "+37491100001", locale: "hy" },
  { key: "aram", name: "Արամ Պետրոսյան", phone: "+37491100002", locale: "hy" },
  { key: "mariam", name: "Մարիամ Սարգսյան", phone: "+37491100003", locale: "hy" },
  { key: "davit", name: "Դավիթ Գրիգորյան", phone: "+37491100004", locale: "hy" },
  { key: "lilit", name: "Լիլիթ Մկրտչյան", phone: "+37491100005", locale: "hy" },
  { key: "narek", name: "Նարեկ Ավետիսյան", phone: "+37491100006", locale: "hy" },
  { key: "sona", name: "Սոնա Կարապետյան", phone: "+37491100007", locale: "hy" },
  { key: "tigran", name: "Տիգրան Հովհաննիսյան", phone: "+37491100008", locale: "hy" },
  { key: "emma", name: "Emma Wilson", phone: "+447700900009", locale: "en" },
  { key: "lucas", name: "Lucas Martin", phone: "+33612345010", locale: "en" },
] as const;

/** What guests write about restaurants, best to worst (picked by rating). */
export const GUEST_COMMENTS: Record<number, string[]> = {
  5: [
    "Ամեն ինչ հիանալի էր, անպայման կվերադառնանք։",
    "Շատ համեղ էր, սպասարկումը՝ արագ ու ջերմ։",
    "Great food and very friendly staff!",
    "Լավագույն տեղը քաղաքում։ QR-ով պատվիրելը շատ հարմար էր։",
  ],
  4: [
    "Համեղ էր, բայց մի քիչ սպասեցինք։",
    "Լավ մթնոլորտ, ուտեստները՝ թարմ։",
    "Nice place, a bit noisy in the evening.",
  ],
  3: ["Նորմալ էր, ոչ ավելին։", "Ուտելիքը լավն էր, բայց սպասարկումը՝ դանդաղ։"],
  2: ["Երկար սպասեցինք, ուտեստը սառն էր։"],
  1: ["Շատ հիասթափված ենք։ Պատվերը սխալ էր։"],
};

/** What restaurants write about guests (two-way reviews). */
export const STAFF_COMMENTS: Record<number, string[]> = {
  5: [
    "Հաճելի հյուրեր, միշտ ժամանակին։",
    "Շատ բարեհամբույր, սպասում ենք կրկին։",
    "Lovely guests, always welcome!",
  ],
  4: ["Լավ հյուրեր, մի փոքր ուշացան։"],
  2: ["Ուշացան 40 րոպե՝ առանց զգուշացնելու։"],
  1: ["Չներկայացան ամրագրմանը։"],
};

export const OWNER_REPLIES = [
  "Շնորհակալություն ջերմ խոսքերի համար, սպասում ենք կրկին։",
  "Շնորհակալ ենք, որ ընտրեցիք մեզ։",
  "Ներողություն սպասելու համար, արդեն շտկում ենք։",
  "Thank you, see you again soon!",
];

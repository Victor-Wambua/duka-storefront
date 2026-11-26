import type { ArtShape, Category, CategoryId, Product, Variant } from '../types';

export const CATEGORIES: Category[] = [
  { id: 'pantry', name: 'Pantry' },
  { id: 'drinks', name: 'Tea & Drinks' },
  { id: 'cleaning', name: 'Cleaning' },
  { id: 'kitchen', name: 'Kitchenware' },
  { id: 'home', name: 'Home & Bedding' },
  { id: 'care', name: 'Personal Care' },
];

/** Sample data: every product, price and stock level here is fictional. */

type V = [label: string, price: number, stock: number, tint?: string];

interface Def {
  slug: string;
  name: string;
  category: CategoryId;
  shape: ArtShape;
  colors: [string, string, string];
  label?: string;
  sublabel?: string;
  blurb: string;
  description: string;
  kind: Product['variantKind'];
  variants: V[];
  tags?: string[];
  badge?: Product['badge'];
}

const defs: Def[] = [
  // ---- Pantry ----
  {
    slug: 'maize-flour', name: 'Maize flour', category: 'pantry', shape: 'bag', colors: ['#F2C14E', '#C98F12', '#8A3B12'],
    label: 'UNGA', sublabel: 'sifted', kind: 'Size', badge: 'Popular', tags: ['unga', 'posho', 'ugali', 'flour'],
    blurb: 'Sifted white maize meal for ugali.',
    description: 'Finely milled, sifted white maize meal. Cooks to a smooth, firm ugali. Stored dry in the shop and packed to order.',
    variants: [['1 kg', 95, 40], ['2 kg', 185, 60], ['5 kg', 450, 18], ['10 kg', 880, 6]],
  },
  {
    slug: 'wheat-flour', name: 'Wheat flour', category: 'pantry', shape: 'bag', colors: ['#F4EBD9', '#C9B48A', '#7A4B1E'],
    label: 'NGANO', sublabel: 'all purpose', kind: 'Size', tags: ['ngano', 'chapati', 'baking', 'flour'],
    blurb: 'All-purpose flour for chapati and mandazi.',
    description: 'All-purpose white wheat flour that rolls out thin for chapati and puffs up well for mandazi.',
    variants: [['1 kg', 130, 30], ['2 kg', 255, 25], ['5 kg', 620, 4]],
  },
  {
    slug: 'pishori-rice', name: 'Pishori rice', category: 'pantry', shape: 'bag', colors: ['#E9F0E4', '#9DB38B', '#2F6B3A'],
    label: 'MCHELE', sublabel: 'pishori', kind: 'Size', badge: 'Popular', tags: ['mchele', 'rice', 'pilau'],
    blurb: 'Aromatic long-grain rice, great for pilau.',
    description: 'Aromatic long-grain rice that stays separate when cooked. The one for pilau on Sundays.',
    variants: [['1 kg', 210, 35], ['2 kg', 410, 22], ['5 kg', 990, 9]],
  },
  {
    slug: 'white-sugar', name: 'White sugar', category: 'pantry', shape: 'bag', colors: ['#FFFFFF', '#CBD5E1', '#2563A8'],
    label: 'SUKARI', sublabel: 'fine', kind: 'Size', tags: ['sukari', 'sugar', 'sweet'],
    blurb: 'Fine granulated sugar.',
    description: 'Fine granulated white sugar for tea, uji and baking.',
    variants: [['1 kg', 190, 50], ['2 kg', 370, 30]],
  },
  {
    slug: 'cooking-oil', name: 'Cooking oil', category: 'pantry', shape: 'bottle', colors: ['#F7C948', '#C99A1E', '#B45309'],
    label: 'MAFUTA', sublabel: 'sunflower', kind: 'Size', badge: 'Popular', tags: ['mafuta', 'oil', 'sunflower', 'fry'],
    blurb: 'Refined sunflower cooking oil.',
    description: 'Refined sunflower oil with a high smoke point. Good for frying, sautéing and chapati.',
    variants: [['500 ml', 190, 30], ['1 litre', 340, 44], ['3 litres', 980, 12], ['5 litres', 1580, 5]],
  },
  {
    slug: 'green-grams', name: 'Green grams (ndengu)', category: 'pantry', shape: 'bag', colors: ['#8DBE6B', '#4D7F3C', '#1F4D2B'],
    label: 'NDENGU', sublabel: 'green grams', kind: 'Size', tags: ['ndengu', 'green grams', 'mung', 'pulses'],
    blurb: 'Clean, sorted green grams.',
    description: 'Hand-sorted green grams that soften quickly. Cook with coconut milk or serve with chapati.',
    variants: [['500 g', 150, 24], ['1 kg', 290, 20], ['2 kg', 570, 7]],
  },
  {
    slug: 'dry-beans', name: 'Rosecoco beans', category: 'pantry', shape: 'bag', colors: ['#C4775A', '#8E4A33', '#F3D9B1'],
    label: 'MAHARAGWE', sublabel: 'rosecoco', kind: 'Size', tags: ['maharagwe', 'beans', 'githeri', 'pulses'],
    blurb: 'Speckled beans for githeri and stew.',
    description: 'Dried rosecoco beans, sorted and stone-free. Soak overnight for githeri or slow stew.',
    variants: [['1 kg', 240, 28], ['2 kg', 470, 14]],
  },
  {
    slug: 'table-salt', name: 'Table salt', category: 'pantry', shape: 'box', colors: ['#EAF2F8', '#9CB6CB', '#1D4E89'],
    label: 'CHUMVI', sublabel: 'iodised', kind: 'Size', tags: ['chumvi', 'salt'],
    blurb: 'Iodised fine salt.',
    description: 'Iodised table salt in a pouring carton.',
    variants: [['500 g', 45, 60], ['1 kg', 80, 45]],
  },
  {
    slug: 'tomato-paste', name: 'Tomato paste', category: 'pantry', shape: 'tin', colors: ['#D93A2B', '#9E2318', '#FFE8A3'],
    label: 'NYANYA', sublabel: 'paste', kind: 'Size', tags: ['nyanya', 'tomato', 'paste', 'sauce'],
    blurb: 'Rich tomato paste for stews.',
    description: 'Concentrated tomato paste that gives stews and sauces body and colour.',
    variants: [['70 g', 40, 80], ['210 g', 105, 50], ['400 g', 190, 3]],
  },
  {
    slug: 'spaghetti', name: 'Spaghetti', category: 'pantry', shape: 'box', colors: ['#F1B24A', '#BE7F1C', '#9B2C2C'],
    label: 'PASTA', sublabel: 'spaghetti', kind: 'Size', tags: ['pasta', 'noodles', 'spaghetti'],
    blurb: 'Durum wheat spaghetti.',
    description: 'Durum wheat spaghetti that holds its bite. Ready in about ten minutes.',
    variants: [['400 g', 110, 40], ['500 g', 135, 32]],
  },

  // ---- Tea & Drinks ----
  {
    slug: 'tea-leaves', name: 'Chai tea leaves', category: 'drinks', shape: 'box', colors: ['#2F7A4E', '#1B4F32', '#F6D365'],
    label: 'CHAI', sublabel: 'black tea', kind: 'Size', badge: 'Popular', tags: ['chai', 'tea', 'leaves', 'black'],
    blurb: 'Strong black tea for Kenyan chai.',
    description: 'Strong CTC black tea. Boil with milk and a little ginger for proper chai.',
    variants: [['100 g', 75, 60], ['250 g', 175, 48], ['500 g', 340, 22]],
  },
  {
    slug: 'ground-coffee', name: 'Ground coffee', category: 'drinks', shape: 'tin', colors: ['#5B3A29', '#3A2218', '#E8C39E'],
    label: 'KAHAWA', sublabel: 'medium roast', kind: 'Size', badge: 'New', tags: ['kahawa', 'coffee', 'ground'],
    blurb: 'Medium-roast ground coffee.',
    description: 'Medium roast, ground for a filter or a sufuria. Smooth with a little fruit.',
    variants: [['100 g', 280, 16], ['250 g', 640, 10]],
  },
  {
    slug: 'drinking-chocolate', name: 'Drinking chocolate', category: 'drinks', shape: 'tin', colors: ['#7B4B2A', '#4E2D16', '#F4D7B6'],
    label: 'KAKAO', sublabel: 'cocoa', kind: 'Size', tags: ['kakao', 'cocoa', 'chocolate'],
    blurb: 'Cocoa for a hot morning drink.',
    description: 'Sweetened cocoa powder. Stir into hot milk for the children, or into uji.',
    variants: [['200 g', 260, 14], ['400 g', 480, 8]],
  },
  {
    slug: 'porridge-flour', name: 'Uji porridge flour', category: 'drinks', shape: 'bag', colors: ['#D9A066', '#A06A33', '#5A3416'],
    label: 'UJI', sublabel: 'mixed grain', kind: 'Size', tags: ['uji', 'porridge', 'millet', 'sorghum'],
    blurb: 'Millet, sorghum and maize blend.',
    description: 'A mixed-grain blend for uji. Whisk into cold water first, then bring to the boil.',
    variants: [['500 g', 120, 26], ['1 kg', 225, 18]],
  },
  {
    slug: 'honey', name: 'Honey', category: 'drinks', shape: 'jar', colors: ['#F0A31C', '#B46F06', '#FFF1C2'],
    label: 'ASALI', sublabel: 'pure', kind: 'Size', badge: 'New', tags: ['asali', 'honey', 'sweet'],
    blurb: 'Thick golden honey.',
    description: 'Thick golden honey in a glass jar. Lovely in tea or on warm chapati.',
    variants: [['250 g', 320, 20], ['500 g', 590, 11]],
  },
  {
    slug: 'long-life-milk', name: 'Long-life milk', category: 'drinks', shape: 'carton', colors: ['#FFFFFF', '#CBD8E4', '#2A6FB0'],
    label: 'MAZIWA', sublabel: 'full cream', kind: 'Pack', tags: ['maziwa', 'milk', 'uht'],
    blurb: 'Full-cream UHT milk, no fridge needed.',
    description: 'Full-cream UHT milk that keeps on the shelf until opened.',
    variants: [['500 ml', 70, 70], ['1 litre', 130, 54], ['6 x 500 ml', 400, 9]],
  },
  {
    slug: 'drinking-water', name: 'Drinking water', category: 'drinks', shape: 'bottle', colors: ['#BFE3F5', '#6DB6DA', '#1B6CA8'],
    label: 'MAJI', sublabel: 'purified', kind: 'Size', tags: ['maji', 'water', 'mineral'],
    blurb: 'Purified drinking water.',
    description: 'Purified still water in a recyclable bottle.',
    variants: [['500 ml', 40, 90], ['1.5 litres', 90, 60], ['12 x 500 ml', 420, 12]],
  },
  {
    slug: 'passion-juice', name: 'Passion juice', category: 'drinks', shape: 'carton', colors: ['#8E3B8E', '#5F1F63', '#FFD54A'],
    label: 'PASSION', sublabel: 'juice drink', kind: 'Size', tags: ['passion', 'juice', 'fruit', 'drink'],
    blurb: 'Tart passion fruit juice drink.',
    description: 'A tart, bright juice drink made with passion fruit pulp.',
    variants: [['500 ml', 85, 40], ['1 litre', 160, 30]],
  },

  // ---- Cleaning ----
  {
    slug: 'laundry-bar', name: 'Laundry bar soap', category: 'cleaning', shape: 'soap', colors: ['#3AA0B8', '#1F6E84', '#E6F6FA'],
    label: 'SABUNI', sublabel: 'laundry', kind: 'Pack', tags: ['sabuni', 'soap', 'laundry', 'bar'],
    blurb: 'Long-lasting bar for hand washing clothes.',
    description: 'A dense laundry bar that lathers well and lasts through the week.',
    variants: [['1 bar', 60, 90], ['3 bars', 170, 50], ['10 bars', 540, 8]],
  },
  {
    slug: 'washing-powder', name: 'Washing powder', category: 'cleaning', shape: 'box', colors: ['#2B8AD6', '#1A5C99', '#FFD84D'],
    label: 'FUA', sublabel: 'powder', kind: 'Size', tags: ['powder', 'detergent', 'laundry', 'washing'],
    blurb: 'Hand and machine washing powder.',
    description: 'Fragranced washing powder for hand or machine washing. Works in cold water.',
    variants: [['500 g', 150, 36], ['1 kg', 280, 28], ['2 kg', 540, 10]],
  },
  {
    slug: 'dish-liquid', name: 'Dish liquid', category: 'cleaning', shape: 'bottle', colors: ['#59C36A', '#2E8B3E', '#FFFFFF'],
    label: 'SAHANI', sublabel: 'dish liquid', kind: 'Size', tags: ['sahani', 'dish', 'washing up', 'liquid'],
    blurb: 'Cuts grease, gentle on hands.',
    description: 'Concentrated dish liquid. A few drops cut through oily sufurias.',
    variants: [['500 ml', 160, 32], ['750 ml', 230, 24], ['2 litres', 560, 7]],
  },
  {
    slug: 'bleach', name: 'Household bleach', category: 'cleaning', shape: 'bottle', colors: ['#E7F0FA', '#9FB9D3', '#C0392B'],
    label: 'BLEACH', sublabel: 'disinfectant', kind: 'Size', tags: ['bleach', 'disinfectant', 'toilet'],
    blurb: 'Disinfects floors, sinks and toilets.',
    description: 'Liquid bleach for disinfecting. Dilute before use and never mix with other cleaners.',
    variants: [['500 ml', 90, 40], ['1 litre', 160, 34], ['3.5 litres', 480, 9]],
  },
  {
    slug: 'floor-cleaner', name: 'Floor cleaner', category: 'cleaning', shape: 'bottle', colors: ['#B07CE0', '#7A47AE', '#F5E9FF'],
    label: 'SAKAFU', sublabel: 'lavender', kind: 'Size', tags: ['floor', 'cleaner', 'mop', 'lavender'],
    blurb: 'Lavender-scented floor cleaner.',
    description: 'Streak-free floor cleaner with a light lavender scent.',
    variants: [['750 ml', 210, 20], ['2 litres', 520, 9]],
  },
  {
    slug: 'toilet-paper', name: 'Toilet paper', category: 'cleaning', shape: 'roll', colors: ['#FFFFFF', '#D5DCE4', '#E85D75'],
    label: 'TISSUE', sublabel: '2-ply', kind: 'Pack', tags: ['tissue', 'toilet', 'paper', 'roll'],
    blurb: 'Soft 2-ply rolls.',
    description: 'Soft two-ply toilet rolls, individually wrapped.',
    variants: [['4 rolls', 140, 40], ['10 rolls', 330, 26], ['20 rolls', 620, 5]],
  },

  // ---- Kitchenware ----
  {
    slug: 'sufuria', name: 'Aluminium sufuria', category: 'kitchen', shape: 'pot', colors: ['#C9CED6', '#8B93A1', '#3C4350'],
    kind: 'Size', badge: 'Popular', tags: ['sufuria', 'pot', 'cooking', 'aluminium', 'saucepan'],
    blurb: 'The everyday cooking pot, with a lid.',
    description: 'A sturdy aluminium sufuria with a snug lid and riveted handles. Heats evenly on charcoal and gas.',
    variants: [['20 cm', 650, 18], ['24 cm', 880, 14], ['28 cm', 1180, 9], ['32 cm', 1560, 3]],
  },
  {
    slug: 'plastic-basin', name: 'Plastic basin', category: 'kitchen', shape: 'bucket', colors: ['#E4572E', '#A83A1B', '#FFD1BF'],
    kind: 'Colour', tags: ['basin', 'bucket', 'wash', 'plastic'],
    blurb: 'Thick plastic basin for washing and storing.',
    description: 'A thick, flexible basin with a rolled rim. Washes clothes and carries vegetables from the market.',
    variants: [['Terracotta', 360, 14, '#E4572E'], ['Teal', 360, 12, '#1FA39A'], ['Sunflower', 360, 10, '#F2B91F'], ['Navy', 360, 6, '#27406E']],
  },
  {
    slug: 'enamel-mug', name: 'Enamel mug', category: 'kitchen', shape: 'mug', colors: ['#2E6FBA', '#1D4A82', '#FFFFFF'],
    kind: 'Colour', tags: ['mug', 'cup', 'enamel', 'tea'],
    blurb: 'Chip-resistant enamel mug with a white rim.',
    description: 'A classic enamel mug that survives the school bag and the campfire. Holds 350 ml.',
    variants: [['Blue', 220, 30, '#2E6FBA'], ['Red', 220, 22, '#C8342B'], ['Green', 220, 4, '#2F8F5B'], ['Black', 220, 18, '#2B2B33']],
  },
  {
    slug: 'dinner-plates', name: 'Dinner plates', category: 'kitchen', shape: 'plates', colors: ['#FFFFFF', '#C9D2DC', '#D4682A'],
    kind: 'Pack', tags: ['plates', 'dishes', 'dinner', 'crockery'],
    blurb: 'Durable melamine plates.',
    description: 'Melamine plates with a printed rim. Light, tough and dishwasher safe.',
    variants: [['Set of 4', 640, 16], ['Set of 6', 920, 10], ['Set of 12', 1750, 2]],
  },
  {
    slug: 'mwiko', name: 'Mwiko wooden spoon', category: 'kitchen', shape: 'spoon', colors: ['#B9803F', '#7E5226', '#E9C48F'],
    kind: 'Size', badge: 'New', tags: ['mwiko', 'spoon', 'ugali', 'wooden', 'stir'],
    blurb: 'Carved hardwood spoon for stirring ugali.',
    description: 'A carved hardwood mwiko with a broad blade, made for stirring thick ugali without scratching the pot.',
    variants: [['30 cm', 160, 25], ['40 cm', 220, 18], ['50 cm', 280, 3]],
  },
  {
    slug: 'thermos-flask', name: 'Vacuum flask', category: 'kitchen', shape: 'flask', colors: ['#2C5F4A', '#173A2D', '#E5E9ED'],
    kind: 'Size', tags: ['flask', 'thermos', 'vacuum', 'hot', 'tea'],
    blurb: 'Keeps chai hot through the afternoon.',
    description: 'Stainless-steel vacuum flask with a screw cup. Hot stays hot for hours.',
    variants: [['500 ml', 980, 11], ['1 litre', 1490, 7], ['2 litres', 2250, 3]],
  },
  {
    slug: 'kikapu', name: 'Sisal kikapu basket', category: 'kitchen', shape: 'basket', colors: ['#C79A5B', '#8D6630', '#2F6B6B'],
    kind: 'Size', tags: ['kikapu', 'basket', 'sisal', 'shopping', 'woven'],
    blurb: 'Hand-woven shopping basket.',
    description: 'A woven sisal kikapu with leather-wrapped handles and a geometric band. Sturdy enough for a full market run.',
    variants: [['Small', 750, 8], ['Medium', 1100, 6], ['Large', 1650, 2]],
  },

  // ---- Home & Bedding ----
  {
    slug: 'kanga-cloth', name: 'Kanga cloth', category: 'home', shape: 'textile', colors: ['#C8372D', '#8F1F18', '#F4C430'],
    kind: 'Colour', badge: 'Popular', tags: ['kanga', 'leso', 'cloth', 'wrap', 'cotton'],
    blurb: 'Printed cotton kanga with a border.',
    description: 'A printed cotton kanga with a bold border, sold as a single wrap (about 1.6 m by 1.1 m). Wear it, carry a baby in it, or cover a table.',
    variants: [['Red & gold', 450, 20, '#C8372D'], ['Indigo', 450, 15, '#2A3F8F'], ['Forest', 450, 12, '#1F7A54'], ['Plum', 450, 4, '#7B2D6B']],
  },
  {
    slug: 'fleece-blanket', name: 'Fleece blanket', category: 'home', shape: 'textile', colors: ['#7A8FB8', '#4E6393', '#E8EDF7'],
    kind: 'Colour', tags: ['blanket', 'fleece', 'warm', 'bedding'],
    blurb: 'Soft, warm fleece for cold Nairobi nights.',
    description: 'A soft double-sided fleece blanket, 150 x 200 cm. Machine washable.',
    variants: [['Slate blue', 1450, 10, '#7A8FB8'], ['Charcoal', 1450, 9, '#4A4F5C'], ['Rose', 1450, 5, '#C9748B']],
  },
  {
    slug: 'bath-towel', name: 'Cotton bath towel', category: 'home', shape: 'textile', colors: ['#2E9C9C', '#1B6666', '#D8F3F0'],
    kind: 'Colour', tags: ['towel', 'bath', 'cotton'],
    blurb: 'Thick, absorbent cotton towel.',
    description: 'A heavy cotton bath towel (70 x 140 cm) that dries fast in the sun.',
    variants: [['Teal', 780, 12, '#2E9C9C'], ['Sand', 780, 10, '#C9AE85'], ['White', 780, 14, '#F1F3F5']],
  },
  {
    slug: 'bed-sheets', name: 'Cotton bed sheet set', category: 'home', shape: 'textile', colors: ['#E8A33D', '#B2741A', '#FFF3DB'],
    kind: 'Size', tags: ['sheets', 'bed', 'bedding', 'cotton', 'pillowcase'],
    blurb: 'Fitted sheet, flat sheet and two pillowcases.',
    description: 'Soft cotton-blend sheet set with a fitted sheet, a flat sheet and two pillowcases.',
    variants: [['3 x 6', 1250, 9], ['4 x 6', 1480, 8], ['5 x 6', 1750, 5], ['6 x 6', 2050, 2]],
  },

  // ---- Personal Care ----
  {
    slug: 'body-lotion', name: 'Body lotion', category: 'care', shape: 'bottle', colors: ['#F4A8B8', '#C96F84', '#FFFFFF'],
    label: 'LOSHENI', sublabel: 'shea & aloe', kind: 'Size', tags: ['lotion', 'body', 'shea', 'aloe', 'moisturiser'],
    blurb: 'Shea and aloe moisturising lotion.',
    description: 'A light, quick-absorbing lotion with shea butter and aloe. Unscented.',
    variants: [['200 ml', 290, 20], ['400 ml', 520, 14], ['1 litre', 1150, 4]],
  },
  {
    slug: 'toothpaste', name: 'Toothpaste', category: 'care', shape: 'tube', colors: ['#E2F3FB', '#9ACDE4', '#D8332F'],
    label: 'MENO', sublabel: 'fluoride', kind: 'Size', tags: ['meno', 'toothpaste', 'teeth', 'fluoride'],
    blurb: 'Fluoride toothpaste, mint flavour.',
    description: 'Fluoride toothpaste with a clean mint flavour.',
    variants: [['75 ml', 150, 44], ['140 ml', 260, 30]],
  },
  {
    slug: 'bathing-soap', name: 'Bathing soap', category: 'care', shape: 'soap', colors: ['#F4B6A6', '#CC7C68', '#FFFFFF'],
    label: 'ROSE', sublabel: 'bathing bar', kind: 'Pack', tags: ['soap', 'bathing', 'rose', 'bar'],
    blurb: 'Gentle rose-scented bar.',
    description: 'A gentle bathing bar with a light rose scent that leaves skin soft.',
    variants: [['1 bar', 70, 80], ['3 bars', 195, 40], ['6 bars', 370, 3]],
  },
  {
    slug: 'petroleum-jelly', name: 'Petroleum jelly', category: 'care', shape: 'jar', colors: ['#6CB6E0', '#2F7FB0', '#FFFFFF'],
    label: 'JELLY', sublabel: 'pure', kind: 'Size', tags: ['jelly', 'petroleum', 'skin', 'lips'],
    blurb: 'Seals in moisture on dry skin and lips.',
    description: 'Pure petroleum jelly for dry skin, lips and cracked heels.',
    variants: [['50 ml', 80, 38], ['250 ml', 270, 22]],
  },
  {
    slug: 'shampoo', name: 'Nourishing shampoo', category: 'care', shape: 'bottle', colors: ['#7C4DBA', '#4F2C86', '#EFE4FF'],
    label: 'NYWELE', sublabel: 'nourishing', kind: 'Size', tags: ['nywele', 'shampoo', 'hair'],
    blurb: 'Gentle shampoo for natural hair.',
    description: 'A sulphate-free shampoo for natural and relaxed hair.',
    variants: [['250 ml', 340, 16], ['500 ml', 610, 9]],
  },
  {
    slug: 'sanitary-pads', name: 'Sanitary pads', category: 'care', shape: 'box', colors: ['#E15A8F', '#A93465', '#FFE0EC'],
    label: 'PADS', sublabel: 'ultra thin', kind: 'Pack', tags: ['pads', 'sanitary', 'period', 'women'],
    blurb: 'Ultra-thin pads with wings.',
    description: 'Ultra-thin sanitary pads with wings, individually wrapped.',
    variants: [['8 pads', 95, 60], ['16 pads', 180, 40], ['3 x 16 pads', 510, 6]],
  },
];

function toProduct(d: Def): Product {
  const variants: Variant[] = d.variants.map(([label, price, stock, tint], i) => ({
    id: `${d.slug}:${i}`,
    label,
    price,
    stock,
    ...(tint ? { tint } : {}),
  }));
  return {
    id: d.slug,
    slug: d.slug,
    name: d.name,
    category: d.category,
    blurb: d.blurb,
    description: d.description,
    variantKind: d.kind,
    variants,
    art: {
      shape: d.shape,
      colors: d.colors,
      ...(d.label ? { label: d.label } : {}),
      ...(d.sublabel ? { sublabel: d.sublabel } : {}),
    },
    tags: d.tags ?? [],
    ...(d.badge ? { badge: d.badge } : {}),
  };
}

export const PRODUCTS: Product[] = defs.map(toProduct);

const bySlug = new Map(PRODUCTS.map((p) => [p.slug, p]));
const variantIndex = new Map<string, { product: Product; variant: Variant }>();
for (const p of PRODUCTS) for (const v of p.variants) variantIndex.set(v.id, { product: p, variant: v });

export function getProduct(slug: string | undefined): Product | undefined {
  return slug ? bySlug.get(slug) : undefined;
}

export function getVariant(variantId: string): { product: Product; variant: Variant } | undefined {
  return variantIndex.get(variantId);
}

export function categoryName(id: CategoryId): string {
  return CATEGORIES.find((c) => c.id === id)?.name ?? id;
}

export function priceRange(p: Product): { min: number; max: number } {
  const prices = p.variants.map((v) => v.price);
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

export function relatedProducts(p: Product, limit = 4): Product[] {
  const sameCat = PRODUCTS.filter((x) => x.category === p.category && x.id !== p.id);
  const tagSet = new Set(p.tags);
  const score = (x: Product) => x.tags.filter((t) => tagSet.has(t)).length;
  return sameCat.sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name)).slice(0, limit);
}

/**
 * Static game data: classes, specs, races, professions and the skill ladder.
 * Nothing here is fetched — it's all baked in so the site works offline.
 *
 * None of it is enforced. The forms use `<input list="...">`, so these lists
 * are suggestions only and you can always type something they don't contain
 * ("AH Bot", "TBD", a race/class combo your version of WoW allows).
 */
window.WOW_DATA = (() => {
  // Official class colours, used for character names and class badges.
  const CLASSES = {
    'Death Knight': { color: '#C41E3A', specs: ['Blood', 'Frost', 'Unholy'] },
    'Demon Hunter': { color: '#A330C9', specs: ['Havoc', 'Vengeance'] },
    Druid: { color: '#FF7C0A', specs: ['Balance', 'Feral (Cat)', 'Feral (Bear)', 'Guardian', 'Restoration'] },
    Evoker: { color: '#33937F', specs: ['Devastation', 'Preservation', 'Augmentation'] },
    Hunter: { color: '#AAD372', specs: ['Beast Mastery', 'Marksmanship', 'Survival'] },
    Mage: { color: '#3FC7EB', specs: ['Arcane', 'Fire', 'Frost'] },
    Monk: { color: '#00FF98', specs: ['Brewmaster', 'Mistweaver', 'Windwalker'] },
    Paladin: { color: '#F48CBA', specs: ['Holy', 'Protection', 'Retribution'] },
    Priest: { color: '#FFFFFF', specs: ['Discipline', 'Holy', 'Shadow'] },
    Rogue: { color: '#FFF468', specs: ['Assassination', 'Combat', 'Outlaw', 'Subtlety'] },
    Shaman: { color: '#0070DD', specs: ['Elemental', 'Enhancement', 'Restoration'] },
    Warlock: { color: '#8788EE', specs: ['Affliction', 'Demonology', 'Destruction'] },
    Warrior: { color: '#C69B6D', specs: ['Arms', 'Fury', 'Protection'] },
  };

  // Spelling we have already seen in the sheet, plus the obvious shorthand.
  const CLASS_ALIASES = {
    shamen: 'Shaman', sham: 'Shaman', shammy: 'Shaman',
    dk: 'Death Knight', dh: 'Demon Hunter',
    pally: 'Paladin', pala: 'Paladin', lock: 'Warlock', warr: 'Warrior',
  };

  const RACES = [
    'Human', 'Dwarf', 'Night Elf', 'Gnome', 'Draenei', 'Worgen',
    'Orc', 'Troll', 'Tauren', 'Undead', 'Blood Elf', 'Goblin',
    'Pandaren', 'Void Elf', 'Lightforged Draenei', 'Dark Iron Dwarf', 'Kul Tiran', 'Mechagnome',
    'Nightborne', 'Highmountain Tauren', 'Mag’har Orc', 'Zandalari Troll', 'Vulpera',
    'Dracthyr', 'Earthen',
  ];

  /**
   * WoW: Forever has 9 primary professions and 3 secondary ones. Note there is
   * no Jewelcrafting or Inscription, Enchanting both gathers and crafts, and
   * the recommended partner for Tailoring is Enchanting (you disenchant what
   * you make). Camping isn't a profession — every profession gets camp objects
   * at skill 20, 140 and 300 instead.
   *
   * kind:  'gathering' | 'crafting' | 'secondary'  — the Professions page groups on this
   * icon:  shown next to the name everywhere
   * makes: a short "what is it for" line, shown on the Professions page
   *
   * Who supplies whom, for reference — the site used to print this on every
   * card and no longer does, so it lives here rather than as fields nothing
   * reads: Mining feeds Blacksmithing and Engineering, Herbalism feeds
   * Alchemy, Skinning feeds Leatherworking, Enchanting feeds Tailoring,
   * Fishing feeds Cooking. Enchanting and Fishing collect their own materials.
   */
  const PROFESSIONS = {
    Mining: { kind: 'gathering', icon: '⛏️', makes: 'Ore, bars, stone and gems' },
    Herbalism: { kind: 'gathering', icon: '🌿', makes: 'Herbs for potions and elixirs' },
    Skinning: { kind: 'gathering', icon: '🔪', makes: 'Leather and hides' },

    Alchemy: { kind: 'crafting', icon: '⚗️', makes: 'Potions, elixirs, flasks' },
    Blacksmithing: { kind: 'crafting', icon: '🔨', makes: 'Plate and mail armour, weapons, sharpening stones' },
    Enchanting: { kind: 'crafting', icon: '✨', makes: 'Enchants, wands and relics — and the dust to make them' },
    Engineering: { kind: 'crafting', icon: '⚙️', makes: 'Bombs, goggles, gadgets, toys' },
    Leatherworking: { kind: 'crafting', icon: '🧵', makes: 'Leather and mail armour, armour kits' },
    Tailoring: { kind: 'crafting', icon: '🧶', makes: 'Cloth armour and bags — cloth comes from drops' },

    Cooking: { kind: 'secondary', icon: '🍖', makes: 'Food buffs' },
    'First Aid': { kind: 'secondary', icon: '🩹', makes: 'Bandages, healing potions, debuff cures' },
    Fishing: { kind: 'secondary', icon: '🎣', makes: 'Fish, for cooking and for Fire Oil' },
  };

  // Spellings from the sheet and the usual abbreviations.
  const PROFESSION_ALIASES = {
    herblore: 'Herbalism', herb: 'Herbalism', herbs: 'Herbalism', herbalist: 'Herbalism',
    mine: 'Mining', miner: 'Mining', ore: 'Mining',
    skin: 'Skinning', skinner: 'Skinning',
    alch: 'Alchemy', alc: 'Alchemy',
    bs: 'Blacksmithing', smithing: 'Blacksmithing', blacksmith: 'Blacksmithing',
    ench: 'Enchanting', enchant: 'Enchanting',
    eng: 'Engineering', engi: 'Engineering', engineer: 'Engineering',
    lw: 'Leatherworking', leather: 'Leatherworking',
    tailor: 'Tailoring', tailering: 'Tailoring',
    cook: 'Cooking', 'first-aid': 'First Aid', firstaid: 'First Aid', fish: 'Fishing',
  };

  /**
   * Forever's four training ranks. `cap` is the highest skill that rank allows,
   * which is what the skill bars fill towards.
   *
   * For reference, since the site doesn't show it: a trainer will teach you the
   * next rank at 50 / 125 / 200 skill, and those ranks need character level
   * 10 / 20 / 35. So you can be sitting at 60 Tailoring, eligible to train
   * Journeyman, but stuck at the Apprentice cap of 75 until you hit level 10.
   */
  const TIERS = [
    { name: 'Apprentice', cap: 75 },
    { name: 'Journeyman', cap: 150 },
    { name: 'Expert', cap: 225 },
    { name: 'Artisan', cap: 300 },
  ];

  // Used only in localStorage mode (empty scriptUrl), so the site has something
  // to show before the Google Sheet is wired up. Mirrors seedRoster() in Code.gs.
  const SEED = [
    { name: 'Daz Moonspear', player: 'Josh', level: 1, race: 'Night Elf', class: 'Druid', spec1: 'Feral (Bear)', spec2: 'Feral (Cat)', prof1: 'Skinning', prof1Level: 1, prof2: 'Leatherworking', prof2Level: 1, notes: 'Transition Skinning to Engineering end game' },
    { name: 'Daz Lighthammer', player: 'Josh', level: 9, race: 'Dwarf', class: 'Paladin', spec1: 'Protection', spec2: 'Retribution', prof1: 'Mining', prof1Level: 1, prof2: 'Blacksmithing', prof2Level: 1, notes: '' },
    { name: 'Daz Stoneblade', player: 'Josh', level: 1, race: 'Night Elf', class: 'Warrior', spec1: 'Protection', spec2: 'Fury', prof1: '', prof1Level: '', prof2: '', prof2Level: '', notes: '' },
    { name: 'Smoke Blazenbeard', player: 'Ian', level: 1, race: 'Dwarf', class: 'Paladin', spec1: 'Retribution', spec2: 'Protection', prof1: '', prof1Level: '', prof2: '', prof2Level: '', notes: '' },
    { name: 'Beard Smokenblaze', player: 'Ian', level: 1, race: 'Dwarf', class: 'Warrior', spec1: 'Fury', spec2: '', prof1: '', prof1Level: '', prof2: '', prof2Level: '', notes: '' },
    { name: 'Soot Kegsplitter', player: 'Adam', level: 9, race: 'Dwarf', class: 'Shaman', spec1: 'Elemental', spec2: 'Restoration', prof1: 'Herbalism', prof1Level: 15, prof2: 'Alchemy', prof2Level: 14, notes: '' },
    { name: 'Summon Yous', player: 'Adam', level: 1, race: 'Human', class: 'Warlock', spec1: 'AH Bot', spec2: 'Summon Bot', prof1: '', prof1Level: '', prof2: '', prof2Level: '', notes: '' },
    { name: 'Oran Ge eard', player: 'Ryan', level: 9, race: 'Dwarf', class: 'Shaman', spec1: 'TBD', spec2: 'TBD', prof1: 'Mining', prof1Level: '', prof2: '', prof2Level: '', notes: '' },
    { name: 'Anya BlazinBraids', player: 'Sam', level: 10, race: 'Dwarf', class: 'Priest', spec1: 'Shadow', spec2: 'TBD', prof1: 'Enchanting', prof1Level: 22, prof2: 'Tailoring', prof2Level: 44, cooking: 12, firstaid: 30, notes: '' },
  ];

  // One example trade so the board isn't empty before anyone posts. Every
  // trade on the board is typed by a person — nothing is generated.
  const SEED_POSTS = [
    { char: 'Anya BlazinBraids', profession: 'Enchanting', item: 'Minor Wizard Oil', mats: 'bring the oil, I have the dust', note: 'free for the group', by: 'Sam' },
  ];

  return { CLASSES, CLASS_ALIASES, RACES, PROFESSIONS, PROFESSION_ALIASES, TIERS, SEED, SEED_POSTS };
})();

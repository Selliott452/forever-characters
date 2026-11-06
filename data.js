/**
 * Static game data for **WoW: Forever**: classes, specs, races, professions and
 * the skill ladder. Nothing here is fetched — it's all baked in so the site
 * works offline.
 *
 * Mostly unenforced. Race, class and spec are `<input list="...">`, so these
 * lists are suggestions and you can always type something they don't contain
 * ("AH Bot", "TBD", a combo a patch adds later). The two profession slots are
 * the exception: they're real dropdowns, so PROFESSIONS below is the whole
 * set of things a character can have.
 *
 * Forever launched 2026-11-04 and differs from Classic in ways worth knowing
 * before editing any of this. Checked against warcrafttavern.com/forever and
 * warcraftforever.games on 2026-11-06; re-check against the live client rather
 * than from memory, since much of the writing about this game is still beta-era.
 */
window.WOW_DATA = (() => {
  /**
   * Forever's nine classes, with their specs. There is no Death Knight, Monk,
   * Demon Hunter or Evoker — the game launched with the nine original classes
   * and added none. Colours are the long-standing official ones.
   *
   * Druid is Balance / Feral Combat / Restoration, one Feral tree rather than
   * the split cat-and-bear specs later versions use, and Rogue has Combat
   * rather than Outlaw. Sources are at the bottom of this file.
   */
  const CLASSES = {
    Druid: { color: '#FF7C0A', specs: ['Balance', 'Feral Combat', 'Restoration'] },
    Hunter: { color: '#AAD372', specs: ['Beast Mastery', 'Marksmanship', 'Survival'] },
    Mage: { color: '#3FC7EB', specs: ['Arcane', 'Fire', 'Frost'] },
    Paladin: { color: '#F48CBA', specs: ['Holy', 'Protection', 'Retribution'] },
    Priest: { color: '#FFFFFF', specs: ['Discipline', 'Holy', 'Shadow'] },
    Rogue: { color: '#FFF468', specs: ['Assassination', 'Combat', 'Subtlety'] },
    Shaman: { color: '#0070DD', specs: ['Elemental', 'Enhancement', 'Restoration'] },
    Warlock: { color: '#8788EE', specs: ['Affliction', 'Demonology', 'Destruction'] },
    Warrior: { color: '#C69B6D', specs: ['Arms', 'Fury', 'Protection'] },
  };

  // Spelling we have already seen in the sheet, plus the obvious shorthand.
  const CLASS_ALIASES = {
    shamen: 'Shaman', sham: 'Shaman', shammy: 'Shaman',
    pally: 'Paladin', pala: 'Paladin', lock: 'Warlock', warr: 'Warrior',
    hunt: 'Hunter', rog: 'Rogue', wl: 'Warlock',
  };

  /**
   * Four races a side, plus Skyborne, who pick their faction at creation and
   * are named for the side they choose. None of the later-expansion races are
   * in Forever — no Blood Elf, Draenei, Worgen, Goblin, Pandaren or anything
   * after them. Both Skyborne names are listed along with the bare "Skyborne",
   * since that is what people actually type.
   */
  const RACES = [
    // Alliance
    'Human', 'Dwarf', 'Night Elf', 'Gnome',
    // Horde
    'Orc', 'Undead', 'Tauren', 'Troll',
    // Either, chosen at character creation
    'Skyborne', 'High Order Skyborne', 'Windshaper Skyborne',
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

  return { CLASSES, CLASS_ALIASES, RACES, PROFESSIONS, PROFESSION_ALIASES, TIERS };
})();

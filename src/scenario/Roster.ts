import {
  ROMAN_ARCHETYPE_IDS,
  type UnitArchetypeId,
} from "../units/UnitArchetypes";

export interface FormationDefinition {
  id: string;
  name: string;
  archetypeId: UnitArchetypeId;
  count: number;
}

export const ROMAN_INFANTRY_STRENGTH = 80;
export const ROMAN_ARCHER_STRENGTH = 54;
export const ROMAN_CAVALRY_STRENGTH = 40;

export interface CompanionDefinition {
  id: string;
  name: string;
  role: string;
  initials: string;
  portraitTone: "red" | "ochre" | "blue" | "green";
  briefingLine: string;
  trustReply: string;
  concernReply: string;
  afterBattleLine: string;
  bloodiedLine: string;
  lostLine: string;
}

export interface RomanFormationDefinition extends FormationDefinition {
  campaignRole: string;
  campaignTrait: string;
  defaultSelected: boolean;
  companion: CompanionDefinition;
}

export const ROMAN_FORMATIONS: readonly RomanFormationDefinition[] = [
  {
    id: "R-I",
    name: "I Cohort · Prima",
    archetypeId: ROMAN_ARCHETYPE_IDS.fieldCentury,
    count: ROMAN_INFANTRY_STRENGTH,
    campaignRole: "Heavy infantry",
    campaignTrait: "Tortoise",
    defaultSelected: true,
    companion: {
      id: "flavia",
      name: "Flavia Marcellus",
      role: "Commander · I Cohort Prima",
      initials: "FM",
      portraitTone: "red",
      briefingLine: "“Give Prima the centre. The wall archers will thin them; our shields will stop what remains.”",
      trustReply: "“Then Prima will be the stone before the Wall. Nothing reaches the gate while I draw breath.”",
      concernReply: "“Let them try. Keep Secunda close and I will turn to meet any warband that slips past.”",
      afterBattleLine: "“The Wall is safe. Prima held, though I will hear their war cries in my sleep for a while.”",
      bloodiedLine: "“Prima held, but the price is written on every shield. Give me time to see to my wounded.”",
      lostLine: "“Prima is gone as a formation. Remember their names before you call this victory.”",
    },
  },
  {
    id: "R-II",
    name: "II Cohort · Secunda",
    archetypeId: ROMAN_ARCHETYPE_IDS.fieldCentury,
    count: ROMAN_INFANTRY_STRENGTH,
    campaignRole: "Heavy infantry",
    campaignTrait: "Disciplined",
    defaultSelected: true,
    companion: {
      id: "cassian",
      name: "Cassian Corvus",
      role: "Commander · II Cohort Secunda",
      initials: "CC",
      portraitTone: "ochre",
      briefingLine: "“The Picts want us drawn away from the milecastle. Hold Secunda back until their centre commits.”",
      trustReply: "“A reserve is only cowardice when it arrives late. Mine will arrive at the killing hour.”",
      concernReply: "“Then place me in the line. I will obey—but we surrender the one surprise we possess.”",
      afterBattleLine: "“A soldier who can still complain can still march. We bought the north another day.”",
      bloodiedLine: "“Secunda arrived at the killing hour. Too many will not march away from it.”",
      lostLine: "“There is no Secunda to hold in reserve now. Only survivors, and a debt.”",
    },
  },
  {
    id: "R-III",
    name: "III Cohort · Tertia",
    archetypeId: ROMAN_ARCHETYPE_IDS.fieldCentury,
    count: ROMAN_INFANTRY_STRENGTH,
    campaignRole: "Heavy infantry",
    campaignTrait: "Deep order",
    defaultSelected: true,
    companion: {
      id: "decimus",
      name: "Decimus Aurelian",
      role: "Commander · III Cohort Tertia",
      initials: "DA",
      portraitTone: "red",
      briefingLine: "“Tertia can take the ford in depth. Give us room to advance and the Saxons will find no gap to turn.”",
      trustReply: "“Then we go shoulder to shoulder. Once Tertia is across, the far bank belongs to Rome.”",
      concernReply: "“Keep Secunda close enough to answer. A narrow crossing rewards patience more than pride.”",
      afterBattleLine: "“Tertia crossed in good order. The ford is wider now only because the Saxons no longer stand in it.”",
      bloodiedLine: "“We crossed, but Tertia is scarcely a cohort now. The ford took its measure of us.”",
      lostLine: "“Tertia reached the far bank. I cannot say that Tertia came back.”",
    },
  },
  {
    id: "R-IV",
    name: "IV Cohort · Quarta",
    archetypeId: ROMAN_ARCHETYPE_IDS.fieldCentury,
    count: ROMAN_INFANTRY_STRENGTH,
    campaignRole: "Heavy infantry",
    campaignTrait: "Fresh levy",
    defaultSelected: false,
    companion: {
      id: "valeria",
      name: "Junia Valeria",
      role: "Commander · IV Cohort Quarta",
      initials: "JV",
      portraitTone: "green",
      briefingLine: "“Quarta is untested, not unwilling. Put us where the line must bend and we will prove the difference.”",
      trustReply: "“You will have a veteran cohort by dusk—or no Quarta left to name.”",
      concernReply: "“Then keep us beside the Draco. Young soldiers stand taller when Rome is watching.”",
      afterBattleLine: "“They called Quarta a levy this morning. They will call us soldiers tomorrow.”",
      bloodiedLine: "“Quarta proved itself. I wish the lesson had demanded fewer lives.”",
      lostLine: "“Quarta earned its name and lost almost everyone who could carry it.”",
    },
  },
  {
    id: "R-CAV",
    name: "Equites Honoriani",
    archetypeId: ROMAN_ARCHETYPE_IDS.armouredEquites,
    count: ROMAN_CAVALRY_STRENGTH,
    campaignRole: "Cavalry",
    campaignTrait: "Flank charge",
    defaultSelected: true,
    companion: {
      id: "brennos",
      name: "Brennos of Venta",
      role: "Commander · Equites Honoriani",
      initials: "BV",
      portraitTone: "blue",
      briefingLine: "“The ground west of the road is firm enough for horses. Loose my riders there and their flank will fold.”",
      trustReply: "“Good. We will ride beyond their sight, then come back like winter.”",
      concernReply: "“If the ground fails us, we dismount. A spear is still a spear, even in the mud.”",
      afterBattleLine: "“Wulfgar’s bowmen learned that mud does not make a horse any less angry.”",
      bloodiedLine: "“The charge landed. Too many saddles returned empty for me to boast of it.”",
      lostLine: "“The Equites are scattered. The horses that came home carry no riders.”",
    },
  },
  {
    id: "R-ARCH",
    name: "Britannic Sagittarii",
    archetypeId: ROMAN_ARCHETYPE_IDS.sagittarii,
    count: ROMAN_ARCHER_STRENGTH,
    campaignRole: "Archers",
    campaignTrait: "12 volleys",
    defaultSelected: true,
    companion: {
      id: "aelia",
      name: "Aelia Naso",
      role: "Commander · Britannic Sagittarii",
      initials: "AN",
      portraitTone: "green",
      briefingLine: "“Twelve volleys. Enough to break one advance, not two. Tell me which enemy matters most.”",
      trustReply: "“The Raven Banner, then. When it falls, every Saxon on that bank will feel alone.”",
      concernReply: "“Then keep me close to the standard. I can preserve the arrows until their shields are turned.”",
      afterBattleLine: "“Save the boasting for camp. We have wounded to count—and arrows to pull from Roman shields.”",
      bloodiedLine: "“We spent more than arrows today. The wounded need quiet, not victory songs.”",
      lostLine: "“The Sagittarii have no volleys left, and too few hands to string the bows.”",
    },
  },
];

export const ROMAN_FORMATION_BY_ID = new Map(
  ROMAN_FORMATIONS.map((formation) => [formation.id, formation]),
);

export const COMPANION_BY_ID = new Map(
  ROMAN_FORMATIONS.map((formation) => [formation.companion.id, formation.companion]),
);

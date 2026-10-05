/* Tour schedule data for the Schedule tab (schedule.js).
   Edit this file to change dates, times, the rehearsal plan or song lengths.
   Posters live in the portal's image storage (site-assets/tour/<city>.jpg); admins upload them on each show card.
   Times are local to each city, 24-hour "HH:MM". Leave a time as null when it isn't confirmed yet. */
window.MT_SCHEDULE = {
  updated: "2026-10-04",
  tagline: "Tinenge Tichingoti Messiah",
  tickets: "Kids $15 · General early bird $70 · VIP early bird $90 · on Eventbrite",

  // Seconds between songs inside a set, and between sets (the band stays on stage).
  songGap: 30,
  setGap: 30,
  // Longer gaps after a particular set, by set number. Set 5 is Eleana's opening set:
  // her band leaves and Minister Michael's band comes on.
  setGapAfter: { "5": 300 },
  changeoverLabel: { "5": "Changeover: Eleana's band off, Minister Michael's band on" },

  // Planned length of each setlist song: [seconds, how it was timed, note].
  // "stems" = measured from the stems (silence trimmed), "guide"/"reference" = from that track,
  // "estimate" = no audio on the portal yet.
  songs: {
    "chiuyai": [342, "stems"],
    "ndinoshamiswa": [1077, "stems", "Timed from her stems. Confirm this is the version she sings"],
    "huvepo-hwenyu": [804, "stems", "Timed from her stems. Confirm this is the version she sings"],
    "makafanira": [390, "estimate"],
    "munenyasha": [365, "stems"],
    "kana-jehovah": [437, "stems"],
    "my-declaration": [321, "guide"],
    "kunaka-kwenyu": [288, "stems"],
    "chiiko": [331, "stems"],
    "ndinobuda": [452, "stems"],
    "salt": [392, "reference"],
    "zvichanaka": [478, "reference"],
    "tawanirwa-nyasha": [337, "stems"],
    "makomborero-praise-medley": [392, "stems"],
    "grace-upon-grace": [390, "estimate"],
    "psalm-23": [390, "estimate"],
    "covenant-keeping-god": [390, "estimate"],
    "yahweh-sabaoth": [390, "estimate"],
    "heiyaya-chant": [390, "estimate"],
    "kudzai-mwari": [406, "stems"],
    "hallelujah": [444, "stems", "Stems run 7:24; the reference track runs 10:27. Confirm the arrangement"],
    "tangai-neni": [412, "stems"],
    "guta": [401, "stems"],
    "rarama": [382, "stems"],
    "makanaka-jesu": [362, "stems"],
    "my-witness": [437, "guide"],
    "mweya-mutsvene": [278, "guide"],
    "king-of-kings": [390, "estimate"],
    "ndamuona": [540, "stems"],
    "africa-for-jesus": [390, "estimate"],
    "bako": [432, "reference", "Includes the hook Minister Michael sings first (about 0:56)"],
    "messiah": [533, "stems", "Includes the hook Minister Michael sings first (about 0:56, approx.)"],
    "makomborero": [369, "stems"],
    "mumoyo": [380, "stems"]
  },
  estimateSeconds: 390,

  // Rehearsal plan blocks: {set: n} = working rehearsal of that set (twice its music time),
  // {run: true} = full run of the show with no stops, {label, min} = fixed block.
  days: [
    {
      id: "rehearsal-1", kind: "rehearsal", day: "2026-10-07",
      title: "Rehearsal day 1", who: "Band and BVs",
      venue: "Glory Lutheran Church", city: "Sherwood Park",
      address: "22577 AB-16, Sherwood Park, AB T8A 4T7",
      start: "10:00", end: "18:00",
      plan: [{ set: 5 }, { set: 1 }, { set: 4 }, { label: "Breaks", min: 40 }],
      note: "A full day. The time left over also has to cover lunch, so start on time."
    },
    {
      id: "rehearsal-2", kind: "rehearsal", day: "2026-10-08",
      title: "Rehearsal day 2", who: "Band and BVs",
      venue: "Glory Lutheran Church", city: "Sherwood Park",
      address: "22577 AB-16, Sherwood Park, AB T8A 4T7",
      start: "10:00", end: "18:00",
      plan: [{ set: 2 }, { set: 3 }, { run: true }, { label: "Breaks", min: 20 }],
      note: "Use the spare time for anything day 1 didn't finish, before the full run."
    },
    {
      id: "edmonton", kind: "show", day: "2026-10-09", city: "Edmonton", theme: "edmonton",
      venue: "Glory Lutheran Church", address: "22577 AB-16, Sherwood Park, AB T8A 4T7",
      poster: "tour/edmonton.jpg",
      soundcheck: ["12:00", "14:00"], call: "18:00", callCheck: true,
      doors: "17:30", start: "18:30", finishBy: "24:00",
      opener: { name: "Victor", min: 45, confirm: true }
    },
    {
      id: "toronto", kind: "show", day: "2026-10-10", city: "Toronto", theme: "toronto",
      venue: "Rexdale Alliance Church", address: "2459 Islington Ave, Etobicoke, ON M9W 3X9",
      poster: "tour/toronto.jpg",
      soundcheck: null, call: null, doors: "17:30", start: null, finishBy: null,
      opener: { name: "Mary", min: null }
    },
    {
      id: "vancouver", kind: "show", day: "2026-10-11", city: "Vancouver", theme: "vancouver",
      venue: "Peace House", address: "12484 82 Ave, Surrey, BC V3W 3E9",
      poster: "tour/vancouver.jpg",
      soundcheck: null, call: null, doors: "17:30", start: null, finishBy: null,
      opener: { name: "Lloyd Tevedzai", min: null, confirm: true }
    }
  ]
};

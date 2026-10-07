/* Tour schedule data for the Schedule tab (schedule.js).
   Edit this file to change dates, times, the rehearsal plan or song lengths.
   Posters live in the portal's image storage (site-assets/tour/<city>.jpg); admins upload them on each show card.
   Times are local to each city, 24-hour "HH:MM". Leave a time as null when it isn't confirmed yet. */
window.MT_SCHEDULE = {
  updated: "2026-10-06",
  tagline: "Tinenge Tichingoti Messiah",
  tickets: "Kids $15 · General early bird $70 · VIP early bird $90 · on Eventbrite",

  // Seconds between songs inside a set, and between sets (the band stays on stage).
  songGap: 30,
  setGap: 30,
  // Longer gaps after a particular set, by set number, e.g. { "5": 300 } for a 5-minute changeover.
  // None for now: the same band plays every set, Eleana's included.
  setGapAfter: {},
  changeoverLabel: {},

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

  // Days in order. Rehearsal days with a timeline show that list of times; without one they show
  // a plan: {set: n} = working rehearsal of that set (twice its music time), {run: true} = full run,
  // {label, min} = fixed block. Show days can also have a timeline (the day plan) and notes.
  // Timeline entries: {at: "HH:MM", to: "HH:MM"} for set times, or {when: "text"} for rough ones.
  days: [
    {
      id: "rehearsal-1", kind: "rehearsal", day: "2026-10-07",
      title: "Rehearsal day 1", who: "Band from 12 pm, BVs from 6 pm",
      venue: "Glory Lutheran Church", city: "Sherwood Park",
      address: "22577 AB-16, Sherwood Park, AB T8A 4T7",
      start: "12:00", end: "22:00",
      timeline: [
        { at: "12:00", to: "18:00", label: "Band" },
        { at: "18:00", label: "BVs join", sub: "Quick break" },
        { at: "22:00", label: "Finish" }
      ],
      notes: [
        "Breakfast for the band at Munya's before rehearsal.",
        "After rehearsal, band members from out of town go to the Airbnb to eat."
      ]
    },
    {
      id: "rehearsal-2", kind: "rehearsal", day: "2026-10-08",
      title: "Rehearsal day 2", who: "Band and artists",
      venue: "Glory Lutheran Church", city: "Sherwood Park",
      address: "22577 AB-16, Sherwood Park, AB T8A 4T7",
      start: "10:00", end: "22:00",
      timeline: [
        { at: "10:00", to: "15:00", label: "Minister Michael", sub: "Quick break at 1 pm" },
        { at: "15:00", label: "Lunch break" },
        { at: "16:00", label: "Mrs Vimbai and Eleana" },
        { at: "19:00", label: "Quick break" },
        { at: "21:00", to: "22:00", label: "Finish" }
      ],
      notes: [
        "Band members from outside Edmonton make their own breakfast at the Airbnb.",
        "The band has its own vehicle to and from rehearsals. Any band member can drive.",
        "Light snacks during sessions.",
        "After rehearsal, band members from out of town go to the Airbnb to eat."
      ]
    },
    {
      id: "edmonton", kind: "show", day: "2026-10-09", city: "Edmonton", theme: "edmonton",
      venue: "Glory Lutheran Church", address: "22577 AB-16, Sherwood Park, AB T8A 4T7",
      poster: "tour/edmonton.jpg",
      soundcheck: null, call: "18:00", callCheck: true,
      doors: "17:30", start: "18:00", finishBy: "24:00",
      timeline: [
        { at: "09:00", label: "Sound engineer setup" },
        { at: "12:00", label: "Musicians soundcheck" },
        { at: "13:30", label: "BVs soundcheck" },
        { at: "14:00", label: "Artists soundcheck", sub: "About 1.5–2 hours" }
      ],
      // Talks before the music, in order: {label, min}.
      before: [{ label: "MC", min: 25 }],
      // Planned at the long end of 25-30 minutes.
      opener: { name: "Victor", min: 30, range: "25–30 min" }
    },
    {
      id: "toronto", kind: "show", day: "2026-10-10", city: "Toronto", theme: "toronto",
      venue: "Rexdale Alliance Church", address: "2459 Islington Ave, Etobicoke, ON M9W 3X9",
      poster: "tour/toronto.jpg",
      soundcheck: ["14:00", "16:00"], call: "18:00", callCheck: true,
      doors: "17:30", start: "18:00", finishBy: "24:00",
      timeline: [
        { when: "6–7 am", label: "Leave Edmonton" },
        { when: "12–1 pm", label: "Arrive in Toronto", sub: "Go straight to the venue. There won't be time to stop." },
        { at: "14:00", to: "16:00", label: "Soundcheck and lunch", sub: "Eat during soundcheck, otherwise eat after" }
      ],
      notes: ["Show: same length and program as Edmonton.", "We eat after the gig."],
      before: [{ label: "MC", min: 25 }],
      opener: { name: "Mary", min: null }
    },
    {
      id: "vancouver", kind: "show", day: "2026-10-11", city: "Vancouver", theme: "vancouver",
      venue: "Peace House", address: "12484 82 Ave, Surrey, BC V3W 3E9",
      poster: "tour/vancouver.jpg",
      soundcheck: null, call: "18:00", callCheck: true,
      doors: "17:30", start: "18:00", finishBy: "24:00",
      timeline: [
        { when: "6–8 am", label: "Leave Toronto" },
        { when: "11 am–12 pm", label: "Arrive in Vancouver", sub: "Go straight to the Airbnb to eat" },
        { at: "14:00", label: "Soundcheck", sub: "Artists take about 1.5–2 hours" },
        { when: "Then", label: "Back to the Airbnb to refresh, then the gig" }
      ],
      notes: ["Show: same program as Edmonton, but no opening act.", "We eat after the gig."],
      before: [{ label: "MC", min: 25 }],
      opener: null
    }
  ]
};

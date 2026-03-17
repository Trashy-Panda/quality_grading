// ============================================================
//  BEEF CARCASS GRADING DRILL — Data Layer
//  data.js
//
//  HOW TO ADD YOUR OWN IMAGES:
//  1. Use the ⚙ Settings button in the app to add images via URL.
//  2. Or paste a JSON array into the Import section of Settings.
//  3. To add images from livestockjudging.com: open a class,
//     right-click the image, copy image address, and paste the
//     URL + correct grade into the Settings form.
// ============================================================

// ------------------------------------------------------------------
//  QUALITY GRADE LOOKUP TABLE
//  Each grade has a unique key, display info, and a position (1–11).
//  The position is used by the scoring algorithm — higher = better.
//  High Choice (8) and Low Prime (9) are in different families
//  and are NEVER treated as equivalent in scoring.
// ------------------------------------------------------------------
const QUALITY_GRADES = [
  { key: 'PR_HI',  label: 'High Prime',      family: 'Prime',      sub: 'High',    position: 11 },
  { key: 'PR_AVG', label: 'Average Prime',    family: 'Prime',      sub: 'Average', position: 10 },
  { key: 'PR_LO',  label: 'Low Prime',        family: 'Prime',      sub: 'Low',     position:  9 },
  { key: 'CH_HI',  label: 'High Choice',      family: 'Choice',     sub: 'High',    position:  8 },
  { key: 'CH_AVG', label: 'Average Choice',   family: 'Choice',     sub: 'Average', position:  7 },
  { key: 'CH_LO',  label: 'Low Choice',       family: 'Choice',     sub: 'Low',     position:  6 },
  { key: 'SE_HI',  label: 'High Select',      family: 'Select',     sub: 'High',    position:  5 },
  { key: 'SE_AVG', label: 'Average Select',   family: 'Select',     sub: 'Average', position:  4, collegiateOnly: true },
  { key: 'SE_LO',  label: 'Low Select',       family: 'Select',     sub: 'Low',     position:  3 },
  { key: 'STD',    label: 'Standard',         family: 'Standard',   sub: null,      position:  2 },
  { key: 'COM',    label: 'Commercial',       family: 'Commercial', sub: null,      position:  1, collegiateOnly: true },
];

// Quick lookup map: key → grade object
const GRADE_MAP = {};
QUALITY_GRADES.forEach(g => { GRADE_MAP[g.key] = g; });

// Grade families for the button matrix Row 1
const GRADE_FAMILIES = ['Prime', 'Choice', 'Select', 'Standard', 'Commercial'];

// ------------------------------------------------------------------
//  DEFAULT CARCASS IMAGE SET
//
//  Images are sourced from publicly accessible USDA and university
//  extension publications. Replace imageUrl values with your own
//  URLs (e.g., from your livestockjudging.com subscription) for a
//  full-featured drill.
//
//  Fields:
//    id          — unique string identifier
//    imageName   — short label shown in the UI
//    imageUrl    — direct URL to the image
//    source      — attribution text
//    correct     — { qualityGrade: KEY, yieldGrade: float }
//    bMaturity   — true if this is a B-Maturity carcass (FFA rule applies)
//    notes       — optional tip shown in Study mode
// ------------------------------------------------------------------
// ------------------------------------------------------------------
//  PLACEHOLDER HELPER
//  Generates a labeled placeholder image via placehold.co.
//  Replace any imageUrl below with a real direct image URL —
//  e.g., right-click a photo on livestockjudging.com → Copy image address.
// ------------------------------------------------------------------
function _ph(label, bg, fg) {
  bg = (bg || '4a1a1a').replace('#', '');
  fg = (fg || 'ffffff').replace('#', '');
  return 'https://placehold.co/800x560/' + bg + '/' + fg + '?text=' + encodeURIComponent(label);
}

const DEFAULT_CARCASSES = [
  {
    id: 'sample-01',
    imageName: 'Carcass 1',
    imageUrl: _ph('Replace with real image\n\nAverage Choice', '2d5a1b', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'CH_AVG' },
    notes: 'Moderate marbling consistent with Average Choice. Fat cover is thin but even.',
  },
  {
    id: 'sample-02',
    imageName: 'Carcass 2',
    imageUrl: _ph('Replace with real image\n\nHigh Select', '1a3a5a', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'SE_HI' },
    notes: 'Slight+ marbling at the upper end of Select.',
  },
  {
    id: 'sample-03',
    imageName: 'Carcass 3',
    imageUrl: _ph('Replace with real image\n\nHigh Choice', '2d5a1b', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'CH_HI' },
    notes: 'Small+ to modest marbling at the top end of Choice.',
  },
  {
    id: 'sample-04',
    imageName: 'Carcass 4',
    imageUrl: _ph('Replace with real image\n\nLow Prime', '6b4700', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'PR_LO' },
    notes: 'Abundant marbling qualifies for Prime at the lower end.',
  },
  {
    id: 'sample-05',
    imageName: 'Carcass 5',
    imageUrl: _ph('Replace with real image\n\nLow Select', '1a3a5a', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'SE_LO' },
    notes: 'Traces to slight marbling — lower end of Select.',
  },
  {
    id: 'sample-06',
    imageName: 'Carcass 6',
    imageUrl: _ph('Replace with real image\n\nLow Choice', '2d5a1b', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'CH_LO' },
    notes: 'Slight marbling at the lower boundary of Choice.',
  },
  {
    id: 'sample-07',
    imageName: 'Carcass 7',
    imageUrl: _ph('Replace with real image\n\nCommercial', '5a2d00', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'COM' },
    notes: 'Older animal — ossification and lean color indicate Commercial grade.',
  },
  {
    id: 'sample-08',
    imageName: 'Carcass 8',
    imageUrl: _ph('Replace with real image\n\nAverage Prime', '6b4700', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'PR_AVG' },
    notes: 'Abundant+ marbling clearly in the middle of the Prime range.',
  },
  {
    id: 'sample-09',
    imageName: 'Carcass 9',
    imageUrl: _ph('Replace with real image\n\nHigh Choice', '2d5a1b', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'CH_HI' },
    notes: 'Modest marbling in the upper Choice range.',
  },
  {
    id: 'sample-10',
    imageName: 'Carcass 10',
    imageUrl: _ph('Replace with real image\n\nStandard', '3a3a3a', 'ffffff'),
    source: 'Placeholder — add real image via ⚙ Settings',
    correct: { qualityGrade: 'STD' },
    notes: 'Practically devoid of marbling — Standard grade.',
  },
];

// ------------------------------------------------------------------
//  COMMUNITY SET CONFIG
//
//  This connects the app to a shared JSONBin.io database so your
//  whole team can submit and drill from the same image set.
//
//  Setup (one-time, done by team admin):
//    1. Create a free account at https://jsonbin.io
//    2. Click "Create Bin" — paste [] as the content — click Save
//    3. Copy the Bin ID from the URL bar
//    4. Go to Account Settings → API Keys → copy your Master Key
//    5. Paste both values below, then re-upload this file to GitHub
//
//  Once configured, the "Community Set" option appears on the home
//  screen and the "Submit to Community" button works in Manage Photos.
// ------------------------------------------------------------------
const COMMUNITY_CONFIG = {
  BIN_ID:     '69b8e443c3097a1dd530c354',   // e.g. '507f1f77bcf86cd799439011'
  MASTER_KEY: '$2a$10$MaoIxHqiGwGV/2tpIxFVtuScTZkt23AmckGzc6CxxBl04amCEcGSu',   // e.g. '$2b$10$...' — keep this file private or use a restricted key
};

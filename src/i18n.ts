import { useSyncExternalStore } from 'react'
import type { Lang } from './lib/types'

const dict = {
  en: {
    appName: 'JalRakshak AI',
    tagline: 'Turn scattered leak reports into prioritized, evidence-backed investigations',
    navReport: 'Report a leak',
    navTrack: 'Track a case',
    navDashboard: 'Operator dashboard',
    navAnalytics: 'Analytics',
    demoBanner: 'PROTOTYPE with clearly labelled DEMO DATA. Reports are stored only in this browser and are not sent to any government department.',
    reportTitle: 'Report a water leak',
    step1: '1. Photo (optional but helps)',
    step2: '2. Where is the leak? Tap the map or use your location',
    step3: '3. Describe the problem (Hindi or English)',
    useLocation: 'Use my location',
    locating: 'Locating...',
    locationSet: 'Location selected',
    locationNone: 'No location selected yet',
    analyze: 'Check my report',
    confirmTitle: 'Please confirm what we understood',
    category: 'Issue type',
    urgency: 'Urgency signals found',
    none: 'none',
    landmark: 'Landmark',
    consent: 'I agree that this report may be reviewed by water-utility staff. I understand this is a demo and nothing is sent to a real department.',
    submit: 'Submit report',
    needLocation: 'Please select a location on the map.',
    needDescription: 'Please describe the problem (at least 10 characters).',
    needConsent: 'Please accept the consent statement.',
    doneTitle: 'Report received',
    yourCase: 'Your case ID',
    saveId: 'Save this ID to track your report.',
    linked: 'This looks like it matches an existing nearby report; they are grouped into one investigation.',
    newReport: 'Submit another report',
    trackTitle: 'Track a case',
    caseIdPlaceholder: 'e.g. JR-DEMO-0001',
    find: 'Find',
    notFound: 'No case found with that ID.',
    status: 'Status',
    reportsInIncident: 'Reports grouped in this investigation',
    verifiedNote: 'Closure verified with evidence by an authorized person.',
    incompleteNote: 'Marked repaired by an operator; evidence is incomplete, so it is NOT shown as verified.',
    langName: 'हिन्दी',
    placeholderDesc: 'e.g. Water gushing from a pipe near the market, road is flooded',
    photoChosen: 'Photo attached',
  },
  hi: {
    appName: 'जलरक्षक AI',
    tagline: 'बिखरी हुई रिसाव शिकायतों को प्राथमिकता वाली, प्रमाण-आधारित जाँच में बदलें',
    navReport: 'रिसाव की शिकायत',
    navTrack: 'शिकायत ट्रैक करें',
    navDashboard: 'ऑपरेटर डैशबोर्ड',
    navAnalytics: 'विश्लेषण',
    demoBanner: 'प्रोटोटाइप: स्पष्ट रूप से चिह्नित डेमो डेटा। शिकायतें केवल इसी ब्राउज़र में रहती हैं और किसी सरकारी विभाग को नहीं भेजी जातीं।',
    reportTitle: 'पानी के रिसाव की शिकायत करें',
    step1: '1. फ़ोटो (वैकल्पिक, पर मददगार)',
    step2: '2. रिसाव कहाँ है? नक्शे पर टैप करें या अपनी लोकेशन लें',
    step3: '3. समस्या बताएँ (हिन्दी या अंग्रेज़ी)',
    useLocation: 'मेरी लोकेशन लें',
    locating: 'लोकेशन खोज रहे हैं...',
    locationSet: 'लोकेशन चुनी गई',
    locationNone: 'अभी तक कोई लोकेशन नहीं चुनी',
    analyze: 'मेरी शिकायत जाँचें',
    confirmTitle: 'कृपया पुष्टि करें कि हमने क्या समझा',
    category: 'समस्या का प्रकार',
    urgency: 'मिले जरूरी संकेत',
    none: 'कोई नहीं',
    landmark: 'पहचान स्थल',
    consent: 'मैं सहमत हूँ कि जल विभाग के कर्मचारी इस शिकायत की समीक्षा कर सकते हैं। मैं समझता/समझती हूँ कि यह डेमो है और असली विभाग को कुछ नहीं भेजा जाता।',
    submit: 'शिकायत जमा करें',
    needLocation: 'कृपया नक्शे पर लोकेशन चुनें।',
    needDescription: 'कृपया समस्या लिखें (कम से कम 10 अक्षर)।',
    needConsent: 'कृपया सहमति स्वीकार करें।',
    doneTitle: 'शिकायत प्राप्त हुई',
    yourCase: 'आपका केस ID',
    saveId: 'अपनी शिकायत ट्रैक करने के लिए यह ID सहेजें।',
    linked: 'यह पास की मौजूदा शिकायत से मेल खाती है; इन्हें एक ही जाँच में जोड़ा गया है।',
    newReport: 'एक और शिकायत करें',
    trackTitle: 'शिकायत ट्रैक करें',
    caseIdPlaceholder: 'जैसे JR-DEMO-0001',
    find: 'खोजें',
    notFound: 'इस ID से कोई केस नहीं मिला।',
    status: 'स्थिति',
    reportsInIncident: 'इस जाँच में जोड़ी गई शिकायतें',
    verifiedNote: 'अधिकृत व्यक्ति द्वारा प्रमाण सहित समापन सत्यापित।',
    incompleteNote: 'ऑपरेटर ने मरम्मत दर्ज की है; प्रमाण अधूरे हैं, इसलिए इसे सत्यापित नहीं दिखाया गया है।',
    langName: 'English',
    placeholderDesc: 'जैसे: बाज़ार के पास पाइप से बहुत पानी बह रहा है, सड़क पर पानी भर गया है',
    photoChosen: 'फ़ोटो जुड़ी',
  },
} as const

export type Key = keyof (typeof dict)['en']

const LS = 'jalrakshak.lang'
let lang: Lang = ((typeof localStorage !== 'undefined' && (localStorage.getItem(LS) as Lang)) || 'en') as Lang
const subs = new Set<() => void>()

export function setLang(l: Lang) {
  lang = l
  if (typeof localStorage !== 'undefined') localStorage.setItem(LS, l)
  subs.forEach((s) => s())
}

export function useLang() {
  const l = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    () => lang,
  )
  return { lang: l, t: (k: Key): string => dict[l][k], setLang }
}

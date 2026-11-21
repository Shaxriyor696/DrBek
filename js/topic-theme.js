// Shared per-topic palette for the dark hero blocks (dashboard "continue" card and the topic page hero).
export const TOPIC_THEMES = {
  '01': ['#1C1838', '#2D2357', '#FF8A5B'], // hujayra — binafşa, mitoxondriya zarğaldoğı
  '02': ['#0E3340', '#175062', '#F6B24A'], // membrana, nerv — akson oltin rangi
  '03': ['#2A0E19', '#4A1730', '#2FD3C1'], // yurak — EKG yaşil-kök çizigi
  '04': ['#0F203F', '#1B3566', '#FF5D62'], // qon aylaniş — arteriya qizili
  '05': ['#0C3140', '#124B5E', '#F4A261'], // buyrak, suyuqlik
  '06': ['#0D3436', '#155152', '#FF7A59'], // qon — eritrotsit marjoni
  '07': ['#102E44', '#1B4864', '#FF8C7A'], // nafas — alveola puşti
  '08': ['#0A2A47', '#10416A', '#FFB703'], // aviatsiya, kosmos, çuqur suv
  '09': ['#25193A', '#3B285A', '#F7C548'], // nerv tizimi — nerv tolasi sariği
  '10': ['#12303A', '#1C4856', '#FF9F43'], // maxsus sezgilar — köz qorasi zarğaldoğı
  '11': ['#191440', '#2B2366', '#FFD166'], // miya — kamalak pöstloq
  '12': ['#2A1714', '#46261F', '#2BC4A9'], // oşqozon-içak
  '13': ['#2A1512', '#47241B', '#FFB347'], // metabolizm, jigar
  '14': ['#2D1230', '#4B1E4E', '#F9A27C'], // endokrin, köpayiş
  '15': ['#0C3332', '#12514E', '#FF6B35'], // sport
};
export function topicTheme(id) {
  const [bg1, bg2, acc] = TOPIC_THEMES[id] || TOPIC_THEMES['06'];
  // light accents (yellow, amber) need dark button text for contrast
  const n = parseInt(acc.slice(1), 16);
  const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  return { bg1, bg2, acc, ink: lum > 0.62 ? bg1 : '#fff' };
}

// CSS custom properties for a hero element: style: themeVars(topicId)
// The hero button / accent is the same brand teal on every topic (only the banner art differs).
export const HERO_ACCENT = '#2FD3C1';
export const HERO_ACCENT_INK = '#16233B';
export const themeVars = (id) => { const t = topicTheme(id); return { '--hb1': t.bg1, '--hb2': t.bg2, '--acc': HERO_ACCENT, '--acc-ink': HERO_ACCENT_INK }; };

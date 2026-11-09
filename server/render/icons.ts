import { createHash } from 'node:crypto';
import { raw, type Html } from './html.js';

const bodies: Record<string, string> = {
  "menu": '<path d="M4 6h16M4 12h16M4 18h16"/>',
  "mail": '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  "shield": '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/>',
  "heart": '<path d="M20 5a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-4 4 0 9 8 15 8-6 12-11 8-15Z"/>',
  "trophy": '<path d="M8 3h8v7a4 4 0 0 1-8 0V3ZM8 5H4v3a4 4 0 0 0 4 4m8-7h4v3a4 4 0 0 1-4 4m-4 2v6m-5 1h10"/>',
  "key": '<circle cx="8" cy="8" r="4"/><path d="m11 11 9 9m-4-4 3-3m-6 0 3-3"/>',
  "arrow-right": "<path d=\"M5 12h14M13 6l6 6-6 6\"/>",
  "calendar-date": "<rect x=\"3\" y=\"4\" width=\"18\" height=\"17\" rx=\"3\"/><path d=\"M8 2v4M16 2v4M3 10h18M8 15h3\"/>",
  "arrow-up-right": "<path d=\"M7 17 17 7M8 7h9v9\"/>",
  "flag": "<path d=\"M5 21V4M5 4h11l-2 4 2 4H5\"/>",
  "pin": "<path d=\"M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z\"/><circle cx=\"12\" cy=\"9.5\" r=\"2.5\"/>",
  "plus": "<path d=\"M12 5v14M5 12h14\"/>",
  "clock": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>",
  "calendar": "<path d=\"M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z\"/>",
  "ball": "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"m12 7 5 4-2 6H9l-2-6 5-4Z\"/>",
  "book": "<path d=\"M12 5v16M3 3c4 0 6 0 9 2 3-2 5-2 9-2v16c-4 0-6 0-9 2-3-2-5-2-9-2V3Z\"/>",
  "users": "<circle cx=\"9\" cy=\"7\" r=\"4\"/><path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M18 8a3 3 0 0 1 0 6M22 21v-2a4 4 0 0 0-3-4\"/>",
  "check": "<path d=\"m5 12 4 4L19 6\"/>",
  "waving-flag": "<path d=\"M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0\"/>",
  "search": "<circle cx=\"10\" cy=\"10\" r=\"6\"/><path d=\"m15 15 6 6\"/>",
  "facebook": "<path d=\"M14 8h3V4h-3c-2.8 0-4.5 1.8-4.5 4.6V11H7v4h2.5v9h4v-9h3l.5-4h-3.5V9c0-.6.4-1 1-1Z\"/>",
  "instagram": "<path d=\"M12 7.3A4.7 4.7 0 1 0 12 16.7 4.7 4.7 0 0 0 12 7.3Zm0 7.7a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm4.9-8.9a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2ZM12 3c-2.4 0-2.7 0-3.7.1-3.3.1-4.9 1.8-5 5C3.1 9.3 3 9.6 3 12s0 2.7.1 3.7c.1 3.2 1.7 4.9 5 5 1 .1 1.3.1 3.9.1s2.7 0 3.7-.1c3.2-.1 4.9-1.8 5-5 .1-1 .1-1.3.1-3.7s0-2.7-.1-3.7c-.1-3.2-1.8-4.9-5-5C14.7 3 14.4 3 12 3Z\"/>",
  "tiktok": "<path d=\"M16.6 3h-3.3v12.3a2.8 2.8 0 1 1-2.8-2.8c.3 0 .6 0 .8.1V9.2a6.1 6.1 0 1 0 5.3 6.1V9.1a7.7 7.7 0 0 0 4.4 1.4V7.2a4.4 4.4 0 0 1-4.4-4.2Z\"/>",
  "close": "<path d=\"M6 6l12 12M18 6 6 18\"/>",
  "contours": "\n      <path d=\"M0 220 C 180 150 320 210 480 170 S 820 90 980 140 S 1280 120 1440 80\"/>\n      <path d=\"M0 250 C 200 190 340 240 520 205 S 840 130 1000 175 S 1290 160 1440 120\"/>\n      <path d=\"M0 280 C 210 230 360 270 540 240 S 860 170 1020 210 S 1300 200 1440 160\"/>\n      <path d=\"M0 310 C 220 270 380 300 560 275 S 880 210 1040 245 S 1310 240 1440 200\"/>\n    ",
  "arrow-up": "<path d=\"M12 19V5M5 12l7-7 7 7\"/>"
};
/** Attributes are template constants, never content. */
export function icon(name: string, attributes = ' viewBox="0 0 24 24" aria-hidden="true"'): Html {
  return raw('<svg' + attributes + '>' + (bodies[name] ?? '') + '</svg>');
}

export const iconHash = createHash('sha256').update(JSON.stringify(bodies)).digest('hex');

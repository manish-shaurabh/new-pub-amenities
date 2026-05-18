/**
 * departmentTheme.js — Department-based color and shape theming for the Platform Vision canvas.
 *
 * Each department gets a distinct visual identity:
 *   - Fill color (bg), border accent, text color
 *   - Icon tint (for Lucide SVG stroke recoloring)
 *   - Shape variant (circle, rounded-rect, hexagon)
 *   - Glow shadow for emphasis
 *
 * Matching is case-insensitive on department name keywords.
 */

const THEMES = {
  electrical: {
    key: 'electrical',
    label: 'Electrical',
    bg: '#fffbeb',
    bgSolid: '#fef3c7',
    border: '#f59e0b',
    text: '#92400e',
    iconTint: '#d97706',
    glow: 'rgba(245,158,11,0.25)',
    shape: 'circle',
    accent: '#fbbf24',
  },
  civil: {
    key: 'civil',
    label: 'Civil',
    bg: '#f8fafc',
    bgSolid: '#e2e8f0',
    border: '#64748b',
    text: '#334155',
    iconTint: '#475569',
    glow: 'rgba(100,116,139,0.2)',
    shape: 'rounded-rect',
    accent: '#94a3b8',
  },
  signal: {
    key: 'signal',
    label: 'S&T / Signal',
    bg: '#eff6ff',
    bgSolid: '#dbeafe',
    border: '#3b82f6',
    text: '#1e40af',
    iconTint: '#2563eb',
    glow: 'rgba(59,130,246,0.25)',
    shape: 'diamond',
    accent: '#60a5fa',
  },
  commercial: {
    key: 'commercial',
    label: 'Commercial',
    bg: '#faf5ff',
    bgSolid: '#ede9fe',
    border: '#8b5cf6',
    text: '#5b21b6',
    iconTint: '#7c3aed',
    glow: 'rgba(139,92,246,0.25)',
    shape: 'circle',
    accent: '#a78bfa',
  },
  mechanical: {
    key: 'mechanical',
    label: 'Mechanical',
    bg: '#fff1f2',
    bgSolid: '#ffe4e6',
    border: '#f43f5e',
    text: '#9f1239',
    iconTint: '#e11d48',
    glow: 'rgba(244,63,94,0.25)',
    shape: 'rounded-rect',
    accent: '#fb7185',
  },
  default: {
    key: 'default',
    label: 'Other',
    bg: '#f0fdfa',
    bgSolid: '#ccfbf1',
    border: '#0d9488',
    text: '#134e4a',
    iconTint: '#0f766e',
    glow: 'rgba(13,148,136,0.2)',
    shape: 'circle',
    accent: '#2dd4bf',
  },
};

// Keyword patterns for matching department names
const DEPT_KEYWORDS = [
  [['electr', 'elec', 'el/'], 'electrical'],
  [['civil', 'civ'], 'civil'],
  [['s&t', 'signal', 'telecom', 'snt'], 'signal'],
  [['commerc', 'comm'], 'commercial'],
  [['mechan', 'mech', 'loco'], 'mechanical'],
];

/**
 * Resolve department theme from department name string.
 * Falls back to 'default' theme.
 */
export function getDeptTheme(deptName) {
  if (!deptName) return THEMES.default;
  const lower = deptName.toLowerCase();
  for (const [keywords, themeKey] of DEPT_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) return THEMES[themeKey];
  }
  return THEMES.default;
}

/**
 * Get department theme by ID using a pre-built departments map.
 * @param {string} deptId
 * @param {Object} deptMap - { id: { name: string, ... } }
 */
export function getDeptThemeById(deptId, deptMap) {
  if (!deptId || !deptMap) return THEMES.default;
  const dept = deptMap[deptId];
  return getDeptTheme(dept?.name || dept);
}

/**
 * CSS border-radius for the given shape.
 */
export function shapeRadius(shape) {
  if (shape === 'rounded-rect') return '22%';
  if (shape === 'diamond') return '4px';
  return '50%';
}

/**
 * CSS transform for diamond shape (45deg rotation).
 */
export function shapeTransform(shape) {
  return shape === 'diamond' ? 'rotate(45deg)' : 'none';
}

/**
 * Counter-rotation for inner content of diamond shapes.
 */
export function shapeInnerTransform(shape) {
  return shape === 'diamond' ? 'rotate(-45deg)' : 'none';
}

export { THEMES };
export default THEMES;

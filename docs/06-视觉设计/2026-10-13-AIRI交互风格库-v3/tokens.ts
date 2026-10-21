// Design reference only.
export const aimyTokens = {
  "meta": {
    "name": "Aimy · AIRI 交互风格库",
    "version": "3.0.0-proposal",
    "date": "2026-10-13",
    "status": "design_reference_only",
    "source": "local Impeccable 4.5.2 guidance + AIRI source + user cat-ear profile reference",
    "icon": "built-in image generation, opaque raster master"
  },
  "theme": {
    "light": {
      "canvas": "#F7F3F6",
      "surface": "#FFFFFF",
      "surfaceSubtle": "#F3EDF1",
      "surfaceRaised": "#FFFFFF",
      "text": "#332A31",
      "textSecondary": "#71616A",
      "textTertiary": "#75616C",
      "border": "#E3D9E0",
      "controlBorder": "#8F7886",
      "action": "#A34368",
      "actionHover": "#8E3659",
      "actionPressed": "#752A49",
      "onAction": "#FFFFFF",
      "accent": "#A34368",
      "accentHover": "#8E3659",
      "accentPressed": "#752A49",
      "accentSoft": "#F7E7EE",
      "onAccent": "#FFFFFF",
      "focus": "#A34368",
      "success": "#35634E",
      "successSoft": "#EBF3EF",
      "warning": "#805C23",
      "warningSoft": "#FBF2E1",
      "danger": "#A53546",
      "dangerSoft": "#FBEDEF",
      "disabled": "#EBE7EE",
      "onDisabled": "#887D91",
      "onDanger": "#FFFFFF"
    },
    "dark": {
      "canvas": "#201C21",
      "surface": "#2A242B",
      "surfaceSubtle": "#352C35",
      "surfaceRaised": "#41343F",
      "text": "#F5EDF3",
      "textSecondary": "#C6B4C0",
      "textTertiary": "#B8A3B1",
      "border": "#50404B",
      "controlBorder": "#A28799",
      "action": "#E6A6BE",
      "actionHover": "#F0BDCF",
      "actionPressed": "#D58EAC",
      "onAction": "#301D27",
      "accent": "#E6A6BE",
      "accentHover": "#F2BCD0",
      "accentPressed": "#D48AA7",
      "accentSoft": "#4A2D3C",
      "onAccent": "#301D27",
      "focus": "#E6A6BE",
      "success": "#A4CCB9",
      "successSoft": "#24372E",
      "warning": "#E3C38D",
      "warningSoft": "#3B3123",
      "danger": "#F4A5B2",
      "dangerSoft": "#432B34",
      "disabled": "#3C3444",
      "onDisabled": "#A89AB4",
      "onDanger": "#2A1822"
    }
  },
  "type": {
    "sans": "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"PingFang SC\", \"Microsoft YaHei\", sans-serif",
    "mono": "\"SFMono-Regular\", Menlo, Consolas, monospace",
    "scale": {
      "caption": 12,
      "label": 13,
      "body": 14,
      "message": 15,
      "subheading": 19,
      "heading": 23,
      "page": 26
    },
    "lineHeight": {
      "compact": 1.3,
      "body": 1.6,
      "message": 1.8
    },
    "weight": {
      "regular": 400,
      "medium": 500,
      "semibold": 600
    }
  },
  "space": [
    4,
    8,
    12,
    16,
    20,
    24,
    32,
    40,
    48,
    64
  ],
  "radius": {
    "small": 6,
    "control": 12,
    "message": 16,
    "window": 20,
    "pill": 999
  },
  "motion": {
    "standard": 180,
    "reveal": 220,
    "easing": "cubic-bezier(.2,.8,.2,1)",
    "reducedMotion": "state changes remain readable; no decorative continuous motion"
  },
  "layout": {
    "chat": {
      "preferredWidth": 560,
      "minWidth": 360,
      "padding": 24
    },
    "settings": {
      "preferredWidth": 960,
      "sidebar": 208
    },
    "island": {
      "button": 44,
      "gap": 8
    },
    "controls": {
      "button": 40,
      "input": 42,
      "iconHit": 36,
      "coarseHit": 44,
      "iconSize": 20,
      "stroke": 1.8
    }
  },
  "elevation": {
    "windowLight": "0 12px 40px #35242E16",
    "windowDark": "0 12px 40px #00000038",
    "popover": "0 12px 38px #2A1A2A28"
  }
} as const;
export type AimyTheme = keyof typeof aimyTokens.theme;

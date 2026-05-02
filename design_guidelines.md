{
  "design_personality": {
    "brand_attributes": [
      "professional",
      "operationally trustworthy",
      "field-friendly (fast, thumbable)",
      "railway/transit themed without clichés",
      "high-clarity data UI"
    ],
    "visual_metaphor": "Transit control-room meets station wayfinding: calm slate surfaces, teal ‘go’ actions, safety-orange for defects/overdue, and signage-like typography for labels.",
    "layout_principles": [
      "F-pattern reading for tables and forms (left-aligned, strong row rhythm)",
      "Bento-style dashboard cards (metrics + mini charts)",
      "‘Command bar’ filtering: primary filters always visible; advanced filters in Sheet/Drawer",
      "Mobile-first: bottom action bar for inspection submit + photo add; sticky section headers"
    ]
  },
  "typography": {
    "google_fonts": {
      "heading": {
        "family": "Space Grotesk",
        "weights": [500, 600, 700],
        "use": "Page titles, KPI numbers, section headers"
      },
      "body": {
        "family": "IBM Plex Sans",
        "weights": [400, 500, 600],
        "use": "Tables, forms, helper text (excellent legibility on mobile)"
      },
      "mono_optional": {
        "family": "IBM Plex Mono",
        "weights": [400, 500],
        "use": "Asset IDs, inspection codes, timestamps"
      }
    },
    "tailwind_type_scale": {
      "h1": "text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tight",
      "h2": "text-base md:text-lg font-medium text-muted-foreground",
      "section_title": "text-lg font-semibold tracking-tight",
      "table_header": "text-xs font-semibold uppercase tracking-wide text-muted-foreground",
      "body": "text-sm md:text-base",
      "small": "text-xs text-muted-foreground"
    },
    "numbers": {
      "kpi": "font-[Space_Grotesk] tabular-nums",
      "table": "tabular-nums"
    }
  },
  "color_system": {
    "notes": [
      "No purple. Use teal/slate/sand with safety orange for Orange List urgency.",
      "Keep gradients decorative only (<=20% viewport)."
    ],
    "css_tokens": {
      "apply_in": "/app/frontend/src/index.css",
      "light": {
        "--background": "210 20% 98%",
        "--foreground": "222 47% 11%",
        "--card": "0 0% 100%",
        "--card-foreground": "222 47% 11%",
        "--popover": "0 0% 100%",
        "--popover-foreground": "222 47% 11%",
        "--primary": "173 80% 28%",
        "--primary-foreground": "0 0% 98%",
        "--secondary": "30 25% 94%",
        "--secondary-foreground": "222 47% 11%",
        "--muted": "210 16% 94%",
        "--muted-foreground": "215 16% 40%",
        "--accent": "173 35% 92%",
        "--accent-foreground": "173 80% 18%",
        "--destructive": "20 90% 52%",
        "--destructive-foreground": "0 0% 98%",
        "--border": "214 18% 86%",
        "--input": "214 18% 86%",
        "--ring": "173 80% 28%",
        "--radius": "0.75rem",
        "--chart-1": "173 80% 28%",
        "--chart-2": "199 70% 38%",
        "--chart-3": "43 74% 56%",
        "--chart-4": "20 90% 52%",
        "--chart-5": "215 16% 40%"
      },
      "dark": {
        "--background": "222 47% 7%",
        "--foreground": "210 20% 98%",
        "--card": "222 47% 9%",
        "--card-foreground": "210 20% 98%",
        "--popover": "222 47% 9%",
        "--popover-foreground": "210 20% 98%",
        "--primary": "173 70% 40%",
        "--primary-foreground": "222 47% 7%",
        "--secondary": "30 18% 14%",
        "--secondary-foreground": "210 20% 98%",
        "--muted": "222 30% 14%",
        "--muted-foreground": "215 16% 70%",
        "--accent": "173 25% 16%",
        "--accent-foreground": "173 70% 85%",
        "--destructive": "20 90% 52%",
        "--destructive-foreground": "0 0% 98%",
        "--border": "222 30% 18%",
        "--input": "222 30% 18%",
        "--ring": "173 70% 40%"
      },
      "extra_tokens": {
        "--surface-2": "210 16% 96%",
        "--shadow-color": "222 47% 11%",
        "--orange-list": "20 90% 52%",
        "--overdue": "20 90% 52%",
        "--ok": "173 80% 28%",
        "--pending": "43 74% 56%",
        "--info": "199 70% 38%"
      }
    },
    "railway_theming": {
      "wayfinding_stripe": "Use a thin left border stripe on critical cards/rows: border-l-4 border-l-primary for active, border-l-4 border-l-[hsl(var(--orange-list))] for Orange List.",
      "status_colors": {
        "working": "bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))] border-[hsl(var(--ok))]/20",
        "defective": "bg-[hsl(var(--orange-list))]/10 text-[hsl(var(--orange-list))] border-[hsl(var(--orange-list))]/20",
        "overdue": "bg-[hsl(var(--overdue))]/10 text-[hsl(var(--overdue))] border-[hsl(var(--overdue))]/20",
        "pending_approval": "bg-[hsl(var(--pending))]/15 text-foreground border-[hsl(var(--pending))]/25"
      }
    },
    "gradients_and_texture": {
      "allowed_usage": [
        "Hero/login header band only",
        "Very subtle section background wash behind dashboard header",
        "Decorative overlay/noise"
      ],
      "gradient_recipes": {
        "login_band": "bg-[radial-gradient(1200px_circle_at_20%_0%,hsl(173_80%_28%/0.14),transparent_55%),radial-gradient(900px_circle_at_90%_10%,hsl(199_70%_38%/0.10),transparent_50%)]",
        "dashboard_wash": "bg-[radial-gradient(900px_circle_at_10%_0%,hsl(173_80%_28%/0.10),transparent_55%)]"
      },
      "noise_overlay": {
        "css": ".noise::before{content:'';position:absolute;inset:0;background-image:url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22%3E%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect width=%22120%22 height=%22120%22 filter=%22url(%23n)%22 opacity=%220.08%22/%3E%3C/svg%3E');mix-blend-mode:multiply;pointer-events:none;border-radius:inherit;}",
        "usage": "Apply to large shells only: header band, sidebar background, empty states. Avoid on dense tables."
      }
    }
  },
  "layout_and_grid": {
    "app_shell": {
      "desktop": {
        "sidebar": "w-[280px] xl:w-[300px] border-r bg-card/60 backdrop-blur supports-[backdrop-filter]:bg-card/50",
        "content": "min-h-screen bg-background",
        "topbar": "sticky top-0 z-40 h-14 bg-background/80 backdrop-blur border-b"
      },
      "mobile": {
        "nav": "Use Sheet (hamburger) OR bottom nav for 4 primary destinations: Dashboard, Assets, Inspect, Orange List.",
        "sticky_actions": "Inspection pages: sticky bottom action bar with primary submit + secondary add photo."
      }
    },
    "page_container": {
      "class": "mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8",
      "section_spacing": "py-4 sm:py-6 lg:py-8",
      "card_spacing": "gap-3 sm:gap-4"
    },
    "dashboard_grid": {
      "kpi_row": "grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4",
      "main": "grid grid-cols-1 xl:grid-cols-12 gap-4",
      "left": "xl:col-span-8",
      "right": "xl:col-span-4"
    },
    "tables": {
      "pattern": "Desktop: table with sticky header. Mobile: switch to card-list rows (each row becomes a Card with key fields + actions).",
      "sticky_header": "sticky top-14 bg-background/90 backdrop-blur",
      "row_density": "Default comfortable; add a ‘Compact’ toggle (Switch) for power users."
    }
  },
  "image_urls": {
    "login_background_reference": [
      {
        "category": "login",
        "description": "Optional monochrome railway signage photo for subtle brand context (use as low-opacity background in login band; ensure readability).",
        "url": "https://images.unsplash.com/photo-1557840654-0475bb3e24e7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTN8MHwxfHNlYXJjaHwyfHxyYWlsd2F5JTIwc3RhdGlvbiUyMHNpZ25hZ2V8ZW58MHx8fGJsYWNrX2FuZF93aGl0ZXwxNzc3NzI3Mjc5fDA&ixlib=rb-4.1.0&q=85"
      },
      {
        "category": "login",
        "description": "Alternate monochrome station/train image for login or empty states (apply grayscale + blur + 6–10% opacity).",
        "url": "https://images.unsplash.com/photo-1539157191018-8f411ca5f394?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1OTN8MHwxfHNlYXJjaHwzfHxyYWlsd2F5JTIwc3RhdGlvbiUyMHNpZ25hZ2V8ZW58MHx8fGJsYWNrX2FuZF93aGl0ZXwxNzc3NzI3Mjc5fDA&ixlib=rb-4.1.0&q=85"
      }
    ]
  },
  "components": {
    "component_path": {
      "shadcn_ui": "/app/frontend/src/components/ui",
      "use_primary": [
        "button.jsx",
        "input.jsx",
        "select.jsx",
        "table.jsx",
        "badge.jsx",
        "card.jsx",
        "tabs.jsx",
        "dialog.jsx",
        "drawer.jsx",
        "sheet.jsx",
        "dropdown-menu.jsx",
        "popover.jsx",
        "calendar.jsx",
        "form.jsx",
        "textarea.jsx",
        "checkbox.jsx",
        "switch.jsx",
        "tooltip.jsx",
        "sonner.jsx"
      ]
    },
    "navigation": {
      "sidebar": {
        "use": ["navigation-menu.jsx", "collapsible.jsx", "scroll-area.jsx", "separator.jsx"],
        "behavior": [
          "Collapsed mode on desktop: icon rail (56px) + tooltip labels",
          "Role-based groups: Operations, Inspections, Admin",
          "Active item: left stripe + subtle accent background"
        ],
        "active_item_classes": "bg-accent text-accent-foreground border-l-4 border-l-primary",
        "inactive_item_classes": "text-muted-foreground hover:text-foreground hover:bg-muted"
      },
      "topbar": {
        "use": ["breadcrumb.jsx", "dropdown-menu.jsx", "avatar.jsx", "button.jsx"],
        "notification_bell": {
          "pattern": "Bell icon button with unread badge; dropdown shows grouped notifications (Today/Earlier) with severity dot.",
          "use": ["popover.jsx", "scroll-area.jsx", "separator.jsx"],
          "data_testid": "topbar-notifications-button"
        }
      },
      "mobile": {
        "sheet_nav": {
          "use": ["sheet.jsx", "accordion.jsx"],
          "data_testid": "mobile-nav-open-button"
        }
      }
    },
    "forms_and_inspections": {
      "inspection_individual": {
        "structure": [
          "Step 1: Asset selector (Command for search) + station/location chips",
          "Step 2: Status (RadioGroup: Working/Defective/Not Found)",
          "Step 3: Checklist (Checkbox list grouped by category)",
          "Step 4: Remarks (Textarea) + Photo upload",
          "Step 5: Submit + Save Draft"
        ],
        "use": ["form.jsx", "command.jsx", "radio-group.jsx", "checkbox.jsx", "textarea.jsx", "card.jsx", "separator.jsx", "progress.jsx"],
        "mobile_patterns": [
          "Sticky progress header (Progress) showing completion",
          "Sticky bottom action bar with primary submit"
        ],
        "photo_upload": {
          "ui": "Use Card with dashed border dropzone + camera button. Show thumbnails in horizontal ScrollArea.",
          "classes": "border-dashed border-2 rounded-xl bg-muted/30 hover:bg-muted/40",
          "data_testid": "inspection-photo-upload"
        }
      },
      "inspection_sig": {
        "structure": [
          "Station selector + date",
          "Participant selection (multi-select via Command + Checkbox)",
          "Station-wide checklist sections",
          "Summary + submit"
        ],
        "use": ["calendar.jsx", "command.jsx", "checkbox.jsx", "tabs.jsx", "card.jsx"],
        "data_testid": "sig-inspection-form"
      }
    },
    "tables_and_filters": {
      "filter_bar": {
        "pattern": "Command-bar row above table: Search input + 2-3 Selects (Station, Status, Department) + ‘More filters’ button opens Sheet.",
        "use": ["input.jsx", "select.jsx", "button.jsx", "sheet.jsx", "badge.jsx"],
        "classes": "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between",
        "data_testid": "table-filter-bar"
      },
      "advanced_filters_sheet": {
        "pattern": "Sheet with accordion sections (Location, Asset Type, Date Range, Overdue only). Apply/Reset pinned at bottom.",
        "use": ["sheet.jsx", "accordion.jsx", "calendar.jsx", "switch.jsx", "button.jsx"],
        "data_testid": "advanced-filters-open-button"
      },
      "row_actions": {
        "pattern": "Kebab menu (DropdownMenu) for secondary actions; primary action as inline Button.",
        "use": ["dropdown-menu.jsx", "button.jsx"],
        "data_testid": "table-row-actions-menu"
      }
    },
    "orange_list": {
      "visual_priority": [
        "Orange List rows/cards must be visually urgent but readable: orange-tinted badge + left stripe + ‘Overdue’ chip.",
        "Provide quick actions: Mark Working (primary teal) and Request Approval (secondary). Approver sees Approve/Reject."
      ],
      "use": ["badge.jsx", "table.jsx", "dialog.jsx", "alert-dialog.jsx", "tabs.jsx"],
      "empty_state": {
        "copy": "No defective assets right now. Great—keep inspections consistent.",
        "use": ["card.jsx", "button.jsx"],
        "data_testid": "orange-list-empty-state"
      }
    },
    "scheduling": {
      "calendar": {
        "rule": "If calendar is required, use shadcn calendar.jsx.",
        "use": ["calendar.jsx", "popover.jsx", "select.jsx"],
        "overdue_list": "Use Tabs: Due Soon / Overdue / Completed. Overdue tab default for supervisors.",
        "data_testid": "schedules-calendar"
      }
    },
    "admin_panel": {
      "pattern": "Same table/filter system; CRUD in Dialog/Drawer. Use Drawer on mobile for forms.",
      "use": ["table.jsx", "dialog.jsx", "drawer.jsx", "form.jsx", "input.jsx", "select.jsx"],
      "data_testid": "admin-panel"
    },
    "feedback": {
      "toasts": {
        "rule": "Use sonner for toasts.",
        "use": ["sonner.jsx"],
        "examples": [
          "Inspection saved",
          "Submitted for approval",
          "Asset marked working"
        ]
      },
      "loading": {
        "use": ["skeleton.jsx", "progress.jsx"],
        "pattern": "Skeleton rows for tables; progress bar for multi-step inspection."
      }
    }
  },
  "buttons": {
    "style": "Professional/Corporate with slight softness",
    "tokens": {
      "--btn-radius": "12px",
      "--btn-shadow": "0 1px 0 hsl(var(--border)), 0 10px 24px -18px hsl(var(--shadow-color) / 0.35)",
      "--btn-press": "active:scale-[0.98]",
      "--btn-transition": "transition-colors duration-150"
    },
    "variants": {
      "primary": "bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring",
      "secondary": "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      "ghost": "hover:bg-muted"
    },
    "sizes": {
      "sm": "h-9 px-3 text-sm",
      "md": "h-10 px-4",
      "lg": "h-11 px-5"
    },
    "data_testid_examples": [
      "login-form-submit-button",
      "asset-create-button",
      "inspection-submit-button",
      "orange-list-mark-working-button",
      "orange-list-approve-button"
    ]
  },
  "motion_and_microinteractions": {
    "library": {
      "recommended": "framer-motion",
      "install": "npm i framer-motion",
      "usage": [
        "Page transitions: fade + slight y (6px) on route change",
        "Card hover: subtle lift shadow only (no transform on large tables)",
        "Notification badge pulse for new items (respect reduced motion)"
      ]
    },
    "principles": [
      "No transition:all. Only transition-colors, shadow, opacity.",
      "Use motion for state changes: filter applied, row updated, submit success.",
      "Prefer 150–220ms durations; easing: ease-out for entrances, ease-in for exits."
    ],
    "examples": {
      "kpi_card_hover": "hover:shadow-[0_12px_30px_-24px_hsl(var(--shadow-color)/0.45)] transition-shadow duration-200",
      "row_highlight_on_update": "animate-in fade-in duration-200"
    }
  },
  "data_dense_ux": {
    "table_usability": [
      "Always show total results + active filters as removable Badges.",
      "Provide column visibility (DropdownMenu) for power users.",
      "Row click opens details Drawer (mobile) / Dialog (desktop)."
    ],
    "inspection_speed": [
      "Default focus on first actionable field.",
      "Use sensible defaults (station from user profile).",
      "Support offline-ish behavior later: allow Save Draft even if submit fails (toast + retry)."
    ]
  },
  "accessibility": {
    "requirements": [
      "WCAG AA contrast for text and icons.",
      "Visible focus rings: focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2.",
      "Touch targets >= 44px height for primary actions on mobile.",
      "Respect prefers-reduced-motion: disable badge pulse and large entrance animations."
    ]
  },
  "data_testid_policy": {
    "rule": "All interactive and key informational elements MUST include data-testid (kebab-case, role-based naming).",
    "examples": [
      "sidebar-nav-dashboard-link",
      "asset-registry-search-input",
      "asset-registry-station-filter-select",
      "inspection-status-radio-working",
      "inspection-remarks-textarea",
      "orange-list-table",
      "notifications-panel-item"
    ]
  },
  "instructions_to_main_agent": {
    "cleanup_existing_css": [
      "Remove/ignore CRA demo styles in /app/frontend/src/App.css (App-header centering etc.). Do NOT center the whole app container.",
      "Keep Tailwind as primary styling; use index.css only for tokens + base styles + optional noise utility."
    ],
    "implementation_notes_js": [
      "Project uses .js/.jsx (not .tsx). Keep components in JSX and avoid TS-only patterns.",
      "Use shadcn components from /src/components/ui only for dropdowns, dialogs, calendar, toast, etc."
    ],
    "role_based_nav": [
      "Hide Admin Panel and User Management routes for non-admin roles.",
      "Show Orange List prominently for supervisors/approvers; add unread badge counts in nav."
    ],
    "charts": {
      "library": "recharts",
      "install": "npm i recharts",
      "patterns": [
        "Dashboard: stacked bar for inspections by station; line for overdue trend; donut for status distribution.",
        "Use chart tokens --chart-1..5 for series colors."
      ]
    }
  }
}

<General UI UX Design Guidelines>  
    - You must **not** apply universal transition. Eg: `transition: all`. This results in breaking transforms. Always add transitions for specific interactive elements like button, input excluding transforms
    - You must **not** center align the app container, ie do not add `.App { text-align: center; }` in the css file. This disrupts the human natural reading flow of text
   - NEVER: use AI assistant Emoji characters like`🤖🧠💭💡🔮🎯📚🎭🎬🎪🎉🎊🎁🎀🎂🍰🎈🎨🎰💰💵💳🏦💎🪙💸🤑📊📈📉💹🔢🏆🥇 etc for icons. Always use **FontAwesome cdn** or **lucid-react** library already installed in the package.json

 **GRADIENT RESTRICTION RULE**
NEVER use dark/saturated gradient combos (e.g., purple/pink) on any UI element.  Prohibited gradients: blue-500 to purple 600, purple 500 to pink-500, green-500 to blue-500, red to pink etc
NEVER use dark gradients for logo, testimonial, footer etc
NEVER let gradients cover more than 20% of the viewport.
NEVER apply gradients to text-heavy content or reading areas.
NEVER use gradients on small UI elements (<100px width).
NEVER stack multiple gradient layers in the same viewport.

**ENFORCEMENT RULE:**
    • Id gradient area exceeds 20% of viewport OR affects readability, **THEN** use solid colors

**How and where to use:**
   • Section backgrounds (not content backgrounds)
   • Hero section header content. Eg: dark to light to dark color
   • Decorative overlays and accent elements only
   • Hero section with 2-3 mild color
   • Gradients creation can be done for any angle say horizontal, vertical or diagonal

- For AI chat, voice application, **do not use purple color. Use color like light green, ocean blue, peach orange etc**

</Font Guidelines>

- Every interaction needs micro-animations - hover states, transitions, parallax effects, and entrance animations. Static = dead. 
   
- Use 2-3x more spacing than feels comfortable. Cramped designs look cheap.

- Subtle grain textures, noise overlays, custom cursors, selection states, and loading animations: separates good from extraordinary.
   
- Before generating UI, infer the visual style from the problem statement (palette, contrast, mood, motion) and immediately instantiate it by setting global design tokens (primary, secondary/accent, background, foreground, ring, state colors), rather than relying on any library defaults. Don't make the background dark as a default step, always understand problem first and define colors accordingly
    Eg: - if it implies playful/energetic, choose a colorful scheme
           - if it implies monochrome/minimal, choose a black–white/neutral scheme

**Component Reuse:**
	- Prioritize using pre-existing components from src/components/ui when applicable
	- Create new components that match the style and conventions of existing components when needed
	- Examine existing components to understand the project's component patterns before creating new ones

**IMPORTANT**: Do not use HTML based component like dropdown, calendar, toast etc. You **MUST** always use `/app/frontend/src/components/ui/ ` only as a primary components as these are modern and stylish component

**Best Practices:**
	- Use Shadcn/UI as the primary component library for consistency and accessibility
	- Import path: ./components/[component-name]

**Export Conventions:**
	- Components MUST use named exports (export const ComponentName = ...)
	- Pages MUST use default exports (export default function PageName() {...})

**Toasts:**
  - Use `sonner` for toasts"
  - Sonner component are located in `/app/src/components/ui/sonner.tsx`

Use 2–4 color gradients, subtle textures/noise overlays, or CSS-based noise to avoid flat visuals.
</General UI UX Design Guidelines>

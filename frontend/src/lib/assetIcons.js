/**
 * assetIcons.js — Shared icon system for the Platform Blueprint.
 *
 * Exported:
 *   ICON_MAP      — { key: LucideIconComponent }
 *   ICON_PRESETS  — [ { key, label } ]  (for admin icon picker)
 *   getIconHint   — keyword auto-detection from asset type name
 */
import {
  Wind, Lightbulb, Droplets, Zap, Wifi, Users, Circle,
  Flame, Camera, Clock, AirVent, Toilet, DoorOpen, Tv,
  Phone, BookOpen, Trash2, Lock, ShieldAlert,
} from 'lucide-react';

export const ICON_MAP = {
  fan:     Wind,
  light:   Lightbulb,
  tap:     Droplets,
  cib:     Zap,
  wifi:    Wifi,
  seat:    Users,
  fire:    Flame,
  camera:  Camera,
  clock:   Clock,
  ac:      AirVent,
  toilet:  Toilet,
  door:    DoorOpen,
  tv:      Tv,
  phone:   Phone,
  sign:    BookOpen,
  bin:     Trash2,
  lock:    Lock,
  safety:  ShieldAlert,
  default: Circle,
};

export const ICON_PRESETS = [
  { key: 'fan',     label: 'Fan / Blower' },
  { key: 'light',   label: 'Light / LED / Lamp' },
  { key: 'tap',     label: 'Water Tap / Fountain' },
  { key: 'cib',     label: 'CIB / Panel / MCB' },
  { key: 'wifi',    label: 'WiFi / Network AP' },
  { key: 'seat',    label: 'Seating / Bench' },
  { key: 'fire',    label: 'Fire Safety / Extinguisher' },
  { key: 'camera',  label: 'CCTV / Camera' },
  { key: 'clock',   label: 'Clock / Display' },
  { key: 'ac',      label: 'AC / Air Conditioner' },
  { key: 'toilet',  label: 'Toilet / Sanitation' },
  { key: 'door',    label: 'Door / Gate' },
  { key: 'tv',      label: 'TV / Display Screen' },
  { key: 'phone',   label: 'Phone / Intercom' },
  { key: 'sign',    label: 'Sign / Notice Board' },
  { key: 'bin',     label: 'Waste Bin' },
  { key: 'lock',    label: 'Lock / Security' },
  { key: 'safety',  label: 'Safety / Alert Equipment' },
  { key: 'default', label: 'Other (generic circle)' },
];

const _KEYWORD_MAP = [
  [['fan', 'blower', 'exhaust', 'ventilat'], 'fan'],
  [['light', 'lamp', 'led', 'bulb', 'tube', 'fluores', 'cfl', 'sodium'], 'light'],
  [['tap', 'water', 'fountain', 'wash'], 'tap'],
  [['cib', 'ceb', 'circuit', 'board', 'panel', 'mcb', 'breaker', 'fuse', 'elec'], 'cib'],
  [['wifi', ' ap ', 'router', 'network', 'internet', 'hotspot', 'wireless'], 'wifi'],
  [['sit', 'bench', 'seat', 'chair', 'wait'], 'seat'],
  [['fire', 'extinguish', 'alarm', 'smoke', 'sprinkler'], 'fire'],
  [['cctv', 'camera', 'surveil', 'surveillance'], 'camera'],
  [['clock', 'watch', 'time display'], 'clock'],
  [['ac ', 'air condition', 'hvac', 'cooler', 'air-con'], 'ac'],
  [['toilet', 'bathroom', 'wc', 'lavatory', 'sanit'], 'toilet'],
  [['door', 'gate', 'entry', 'exit', 'shutter'], 'door'],
  [['tv', 'screen', 'display', 'monitor', 'pis', 'coach indicator'], 'tv'],
  [['phone', 'intercom', 'telephone', 'helpline'], 'phone'],
  [['sign', 'notice', 'board', 'nameplat', 'placard'], 'sign'],
  [['bin', 'dustbin', 'waste', 'trash', 'garbage'], 'bin'],
  [['lock', 'padlock', 'security'], 'lock'],
  [['first aid', 'stretcher', 'safety', 'emergency'], 'safety'],
];

/** Auto-detect icon key from asset type name. Returns 'default' if no match. */
export function getIconHint(name) {
  const n = ' ' + (name || '').toLowerCase() + ' ';
  for (const [keywords, hint] of _KEYWORD_MAP) {
    if (keywords.some(kw => n.includes(kw))) return hint;
  }
  return 'default';
}

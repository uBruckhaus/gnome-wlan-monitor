// Detail panel: Wi-Fi link and signal quality in plain words, live throughput, and the
// list of devices on the local WLAN with a type icon. Clicking a device expands its
// details (status explained, maker, model, MAC) with actions: rename, pin, hide, open
// its web page, mark as known. Names, pins and hidden flags are stored per network by
// the collector; on trusted networks it also flags devices that joined recently.
// A second page draws the network as a tree (Internet › router › groups › devices).

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {t, tn} from './strings.js';

const DIM = 150;                    // opacity of secondary text
const MAP_INDENT = 22;              // px per tree level on the network map
const WEB_URL = /^https?:\/\/(\d{1,3}\.){3}\d{1,3}(:\d{1,5})?\/[A-Za-z0-9._~/-]{0,100}$/;
const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;

// Signal level: green >= 70 %, yellow >= 50 %, orange >= 30 %, red below (GNOME palette).
export const COLORS = {green: '#33d17a', yellow: '#f6d32d', orange: '#ff7800', red: '#e01b24', blue: '#3584e4'};

export function signalColor(fraction) {
    if (fraction >= 0.7)
        return COLORS.green;
    if (fraction >= 0.5)
        return COLORS.yellow;
    if (fraction >= 0.3)
        return COLORS.orange;
    return COLORS.red;
}

export function signalWord(quality) {
    const q = Number(quality || 0);
    return q >= 70 ? t('sigExcellent') : q >= 50 ? t('sigGood') : q >= 30 ? t('sigFair') : t('sigWeak');
}

export function isWebUrl(url) {
    return WEB_URL.test(String(url || ''));
}

export function isIpv4(ip) {
    return IPV4.test(String(ip || ''));
}

const KIND_ICONS = {
    router: 'network-wireless-symbolic', computer: 'computer-symbolic', laptop: 'computer-symbolic',
    phone: 'phone-symbolic', tablet: 'tablet-symbolic', watch: 'preferences-system-time-symbolic',
    tv: 'tv-symbolic', speaker: 'audio-speakers-symbolic', printer: 'printer-symbolic',
    console: 'input-gaming-symbolic', camera: 'camera-web-symbolic', light: 'night-light-symbolic',
    nas: 'drive-harddisk-symbolic', appliance: 'application-x-appliance-symbolic',
    smarthome: 'user-home-symbolic', unknown: 'dialog-question-symbolic',
};

const KIND_LABELS = {
    router: 'kRouter', computer: 'kComputer', laptop: 'kLaptop', phone: 'kPhone', tablet: 'kTablet',
    watch: 'kWatch', tv: 'kTv', speaker: 'kSpeaker', printer: 'kPrinter', console: 'kConsole',
    camera: 'kCamera', light: 'kLight', nas: 'kNas', appliance: 'kAppliance', smarthome: 'kSmarthome',
    unknown: 'kUnknown',
};

const GROUPS = {
    favourites: {title: () => t('gFavourites'), icon: 'starred-symbolic'},
    apple: {title: () => 'Apple', icon: 'phone-apple-iphone-symbolic'},
    android: {title: () => 'Android', icon: 'phone-symbolic'},
    mobile: {title: () => t('gMobile'), icon: 'tablet-symbolic'},
    computers: {title: () => t('gComputers'), icon: 'computer-symbolic'},
    media: {title: () => t('gMedia'), icon: 'tv-symbolic'},
    smarthome: {title: () => t('gSmarthome'), icon: 'user-home-symbolic'},
    office: {title: () => t('gOffice'), icon: 'printer-symbolic'},
    network: {title: () => t('gNetwork'), icon: 'network-workgroup-symbolic'},
    other: {title: () => t('gOther'), icon: 'dialog-question-symbolic'},
    none: {title: () => t('gNone'), icon: 'dialog-question-symbolic'},
    gsix: {title: () => '6 GHz', icon: 'network-wireless-symbolic'},
    gfive: {title: () => '5 GHz', icon: 'network-wireless-symbolic'},
    gtwo: {title: () => '2.4 GHz', icon: 'network-wireless-symbolic'},
    glan: {title: () => t('gLan'), icon: 'network-wired-symbolic'},
    gother: {title: () => t('gBandUnknown'), icon: 'dialog-question-symbolic'},
    gsleep: {title: () => t('gSleep'), icon: 'weather-clear-night-symbolic'},
};

const PLATFORM_ORDER = ['favourites', 'apple', 'android', 'mobile', 'computers', 'media', 'smarthome', 'office', 'network', 'other'];
const TYPE_ORDER = ['favourites', 'mobile', 'computers', 'media', 'smarthome', 'office', 'network', 'other'];
const BAND_GROUP_ORDER = ['favourites', 'gsix', 'gfive', 'gtwo', 'glan', 'gother', 'gsleep'];
const BAND_IDS = {'6 GHz': 'gsix', '5 GHz': 'gfive', '2.4 GHz': 'gtwo', 'LAN': 'glan'};
const KIND_GROUPS = {
    router: 'network', phone: 'mobile', tablet: 'mobile', watch: 'mobile', computer: 'computers', laptop: 'computers',
    tv: 'media', speaker: 'media', console: 'media', smarthome: 'smarthome', light: 'smarthome',
    appliance: 'smarthome', camera: 'smarthome', printer: 'office', nas: 'office',
};
const VIEW_SHORT = {list: 'shortList', platform: 'shortPlatform', type: 'shortType', band: 'shortBand', ap: 'shortAp'};

function orderFor(mode) {
    return mode === 'band' ? BAND_GROUP_ORDER : mode === 'type' ? TYPE_ORDER : PLATFORM_ORDER;
}

function groupInfo(id) {
    const info = GROUPS[id] || GROUPS.other;
    return {title: info.title(), icon: info.icon};
}

export function kindLabel(kind) {
    return t(KIND_LABELS[kind] || KIND_LABELS.unknown);
}

function kindIcon(kind) {
    return KIND_ICONS[kind] || KIND_ICONS.unknown;
}

function deviceKindLabel(dev) {
    return dev.kind === 'router' && !dev.is_gateway ? t('repeaterAp') : kindLabel(dev.kind);
}

function signalQuality(dbm) {
    if (dbm === null || dbm === undefined)
        return -1;
    return Math.max(0, Math.min(100, 2 * (Number(dbm) + 100)));
}

function formatBytes(bytes) {
    const b = Number(bytes || 0);
    if (b >= 1073741824)
        return `${(b / 1073741824).toFixed(1)} GiB`;
    if (b >= 1048576)
        return `${(b / 1048576).toFixed(1)} MiB`;
    if (b >= 1024)
        return `${(b / 1024).toFixed(0)} KiB`;
    return `${b} B`;
}

function formatRate(bytesPerSec) {
    if (bytesPerSec === null || bytesPerSec === undefined)
        return '—';
    const r = Number(bytesPerSec);
    if (r >= 1048576)
        return `${(r / 1048576).toFixed(1)} MB/s`;
    if (r >= 1024)
        return `${(r / 1024).toFixed(1)} KB/s`;
    return `${Math.round(r)} B/s`;
}

function agoText(minutes) {
    const m = Number(minutes);
    if (minutes === null || minutes === undefined || !isFinite(m))
        return '';
    if (m < 1)
        return t('justNow');
    if (m < 60)
        return t('minAgo', [m]);
    return t('hAgo', [Math.floor(m / 60)]);
}

export function statusWord(dev) {
    if (dev.is_gateway)
        return t('stRouter');
    if (dev.is_self)
        return t('stThisPc');
    if (dev.online)
        return t('stOnline');
    if (dev.state === 'idle')
        return t('stIdle');
    const ago = agoText(dev.seen_min);
    return t('stSleeping') + (ago ? ` · ${ago}` : '');
}

function statusExplain(dev) {
    if (dev.is_gateway)
        return t('exGateway');
    if (dev.is_self)
        return t('exSelf');
    if (dev.online)
        return t('exOnline');
    if (dev.state === 'idle')
        return t('exIdle');
    const ago = agoText(dev.seen_min);
    return `${t('exSleeping')} ${ago ? t('lastSeen', [ago]) : t('knownFromRouter')}`;
}

function deviceKey(dev) {
    return String(dev.mac || dev.ip || '');
}

// ---------------------------------------------------------------------------------- widgets

function label(text = '', styleClass = '', props = {}) {
    const actor = new St.Label({text, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, ...props});
    actor.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    return actor;
}

function dimmed(actor) {
    actor.opacity = DIM;
    return actor;
}

function wrapping(actor) {
    actor.clutter_text.line_wrap = true;
    actor.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
    actor.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return actor;
}

function icon(name, styleClass = 'wlan-icon') {
    return new St.Icon({icon_name: name, style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
}

function hbox(props = {}) {
    return new St.BoxLayout({x_expand: true, ...props});
}

function vbox(props = {}) {
    return new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, ...props});
}

// A small text action (icon + words) used in details and footers.
function linkButton(iconName, text, onClick, styleClass = '') {
    const box = new St.BoxLayout({style_class: 'wlan-link-box'});
    const glyph = iconName ? icon(iconName, 'wlan-link-icon') : null;
    if (glyph)
        box.add_child(glyph);
    const words = new St.Label({text, y_align: Clutter.ActorAlign.CENTER});
    box.add_child(words);
    const button = new St.Button({child: box, style_class: `wlan-link ${styleClass}`, can_focus: true});
    button.connect('clicked', () => onClick());
    button._icon = glyph;
    button._label = words;
    return button;
}

// A bordered button like the panel's footer buttons.
function pillButton(iconName, text, onClick) {
    const box = new St.BoxLayout({style_class: 'wlan-pill-box'});
    if (iconName)
        box.add_child(icon(iconName, 'wlan-pill-icon'));
    if (text !== null)
        box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
    const button = new St.Button({child: box, style_class: 'wlan-pill', can_focus: true});
    button.connect('clicked', () => onClick());
    return button;
}

function setSensitive(button, sensitive) {
    button.reactive = sensitive;
    button.can_focus = sensitive;
    button.opacity = sensitive ? 255 : 110;
}

function sectionHeader(text) {
    return label(text.toUpperCase(), 'wlan-section');
}

function separator() {
    return new St.Widget({style_class: 'wlan-separator', x_expand: true});
}

// A rounded track with a fill (fraction 0..1, CSS colour).
class Bar {
    constructor(styleClass) {
        this.actor = new St.BoxLayout({style_class: `wlan-track ${styleClass}`, x_expand: true});
        this._fill = new St.Widget({y_expand: true, style_class: 'wlan-fill'});
        this._fraction = 0;
        this.actor.add_child(this._fill);
        this.actor.connect('notify::allocation', () => this._layout());
    }

    set(fraction, color) {
        this._fraction = Math.max(0, Math.min(1, fraction || 0));
        this._fill.style = color ? `background-color: ${color};` : '';
        this._layout();
    }

    _layout() {
        // The allocation, not .width: asking an actor off the stage for its size is an error.
        const width = this.actor.has_allocation() ? this.actor.allocation.get_width() : 0;
        this._fill.width = Math.round(width * this._fraction);
    }
}

// Label left, value right, a bar underneath (signal, traffic).
class Meter {
    constructor() {
        this.actor = vbox({style_class: 'wlan-meter'});
        const row = hbox();
        this._label = dimmed(label('', 'wlan-caption', {x_expand: true}));
        this._value = label('', 'wlan-caption');
        row.add_child(this._label);
        row.add_child(this._value);
        this._bar = new Bar('wlan-bar-meter');
        this._tip = wrapping(dimmed(label('', 'wlan-caption wlan-tip')));
        this._tip.visible = false;
        this.actor.add_child(row);
        this.actor.add_child(this._bar.actor);
        this.actor.add_child(this._tip);
        // Hover shows the explanation the QML widget had as a tooltip.
        this.actor.reactive = true;
        this.actor.track_hover = true;
        this.actor.connect('notify::hover', () => (this._tip.visible = this.actor.hover && this._tip.text !== ''));
    }

    update(name, value, fraction, color, tip = '') {
        this._label.text = name;
        this._value.text = value;
        this._bar.set(fraction, color);
        this._tip.text = tip;
    }
}

// Four signal bars coloured like the bar indicator's signal levels.
function signalBars(quality) {
    const box = new St.BoxLayout({style_class: 'wlan-signal-bars', y_align: Clutter.ActorAlign.CENTER});
    [0, 30, 50, 70].forEach((limit, index) => {
        const lit = quality > limit || (index === 0 && quality >= 0);
        box.add_child(new St.Widget({
            style_class: 'wlan-signal-bar',
            y_align: Clutter.ActorAlign.END,
            style: `height: ${4 + index * 3}px; background-color: ${lit ? signalColor(quality / 100) : 'rgba(128,128,128,0.35)'};`,
        }));
    });
    return box;
}

// ---------------------------------------------------------------------------------- panel

export class WlanPanel {
    // host: send(cmd), sendJson(obj), rescan(), setTrusted(on), scanning, openWeb(url),
    // copyText(text), openWifiSettings(), gicon.
    constructor(host) {
        this._host = host;
        this.stats = {};
        this._devices = [];
        this._devicesRev = '';
        this._expandedKey = '';
        this._editingKey = '';
        this._showHidden = false;
        this._filterText = '';
        this._localView = null;
        this._fritzFormOpen = false;
        this._fritzHelpOpen = false;
        this._chooser = '';                  // 'list' / 'map': the grouping choices are shown
        this._listSignature = null;
        this._mapSignature = null;
        this._timeouts = new Set();

        this.actor = vbox({style_class: 'wlan-panel'});
        this._buildHero();
        this._buildTabs();
        this._buildVpnNotice();
        this._buildDevicesPage();
        this._buildMapPage();
        this.actor.add_child(separator());
        this._buildFooter();
        this.actor.connect('destroy', () => this._clearTimeouts());
    }

    // ------------------------------------------------------------------ derived state

    get _link() {
        return this.stats.link || {};
    }

    get _fritz() {
        return this.stats.fritz || {};
    }

    get _vpn() {
        return this._link.vpn || null;
    }

    get _lanBlocked() {
        return this._vpn !== null && this._vpn.lan_blocked === true;
    }

    get _trusted() {
        return this._link.trusted === true;
    }

    get _view() {
        return this._localView || this.stats.view || {mode: 'list', collapsed: []};
    }

    get _collapsed() {
        return this._view.collapsed || [];
    }

    get _meshActive() {
        return this.stats.mesh_active === true;
    }

    get _viewMode() {
        const mode = this._view.mode;
        return (mode === 'ap' || mode === 'band') && !this._meshActive ? 'platform' : String(mode || 'list');
    }

    get _viewModes() {
        return this._meshActive ? ['list', 'platform', 'type', 'band', 'ap'] : ['list', 'platform', 'type'];
    }

    get _mapPage() {
        return this._collapsed.includes('mappage');
    }

    get _infoOpen() {
        return this._collapsed.includes('showinfo');
    }

    get _gatewayDevice() {
        return this._devices.find(d => d.is_gateway) || null;
    }

    // "Allow it with: <command>" hints carry a command the user can copy.
    get _vpnCommand() {
        const hint = this._vpn ? String(this._vpn.hint || '') : '';
        return hint.startsWith('Allow it with: ') ? hint.slice(15) : '';
    }

    get _vpnHint() {
        return this._vpnCommand ? t('allowWith', [this._vpnCommand]) : t('vpnHintGeneric');
    }

    _saveView(mode, collapsed) {
        this._localView = {mode, collapsed};
        this._host.sendJson({cmd: 'view', mode, collapsed});
        this._refresh();
    }

    _toggleGroup(id) {
        const collapsed = this._collapsed.slice();
        const at = collapsed.indexOf(id);
        if (at === -1)
            collapsed.push(id);
        else
            collapsed.splice(at, 1);
        this._saveView(this._viewMode, collapsed.slice(0, 32));
    }

    _setViewMode(mode) {
        this._chooser = '';
        if (this._viewModes.includes(mode) && mode !== this._viewMode)
            this._saveView(mode, this._collapsed);
        else
            this._refresh();
    }

    _foldAll(fold, ids) {
        let collapsed = this._collapsed.filter(id => !ids.includes(id));
        if (fold)
            collapsed = collapsed.concat(ids);
        this._saveView(this._viewMode, collapsed.slice(0, 32));
    }

    // Every foldable branch of the map in the current grouping: groups and repeaters.
    get _mapFoldIds() {
        const ids = orderFor(this._viewMode).slice();
        (this._fritz.aps || []).forEach(ap => {
            if (ap.role !== 'master')
                ids.push(ap.mac);
        });
        return ids;
    }

    // Groups of the Devices page in the current grouping (access-point mode groups by MAC).
    get _listFoldIds() {
        if (this._viewMode === 'ap')
            return [...(this._fritz.aps || []).map(ap => ap.mac), 'none'];
        return this._viewMode === 'list' ? [] : orderFor(this._viewMode).slice();
    }

    _bandOf(dev) {
        if (dev.mesh && dev.mesh.band)
            return dev.mesh.band;
        if (dev.is_self && this._link.via_band)
            return this._link.via_band;
        return '';
    }

    // The one grouping rule both pages use (list and access-point views have no groups here).
    _groupOf(dev) {
        if (dev.pinned)
            return 'favourites';
        const mode = this._viewMode;
        if (mode === 'platform')
            return dev.group || 'other';
        if (mode === 'type')
            return KIND_GROUPS[dev.kind] || 'other';
        if (mode === 'band') {
            const band = this._bandOf(dev);
            if (band)
                return BAND_IDS[band] || 'gother';
            return dev.online ? 'gother' : 'gsleep';
        }
        return '';
    }

    _groupIdOf(dev) {
        if (dev.is_gateway || dev.is_self)
            return '';
        if (this._viewMode === 'ap')
            return dev.mesh && dev.mesh.via_mac ? dev.mesh.via_mac : 'none';
        return this._groupOf(dev);
    }

    _meshText(dev) {
        const m = dev.mesh;
        if (!m || !m.via)
            return '';
        // With a single access point "via …" says nothing new; the band is enough.
        if ((this._fritz.aps || []).length <= 1)
            return m.band === 'LAN' ? t('cable') : m.band || '';
        return t('viaN', [m.via]) + (m.band ? ` · ${m.band}` : '');
    }

    _meshDetail(dev) {
        const m = dev.mesh;
        if (!m || (!m.band && !m.rate_mbps))
            return '';
        const parts = [];
        if (m.band)
            parts.push(m.band === 'LAN' ? t('cableLan') : m.band);
        if (m.rate_mbps)
            parts.push(`${m.rate_mbps} Mbit/s`);
        if (m.signal_dbm !== null && m.signal_dbm !== undefined)
            parts.push(t('sigLine', [signalWord(signalQuality(m.signal_dbm)).toLowerCase(), m.signal_dbm]));
        return parts.join(' · ');
    }

    _deviceRightLabel(dev) {
        const word = statusWord(dev);
        return (word === t('stOnline') || word === t('stRouter') ? '' : `${word} · `) + dev.ip;
    }

    _deviceSubtitle(dev) {
        const kind = deviceKindLabel(dev);
        const parts = dev.name.startsWith(kind) ? [] : [kind];
        if (dev.is_gateway && dev.model && !dev.name.includes(dev.model))
            parts.push(t('modelN', [dev.model]));
        // The band is already the group heading when grouping by band.
        const mesh = this._meshText(dev);
        if (mesh && !(this._viewMode === 'band' && !dev.is_self))
            parts.push(mesh);
        if (dev.vendor && dev.vendor !== 'Private MAC' && !dev.name.includes(dev.vendor))
            parts.push(dev.vendor);
        if (dev.custom_name && dev.auto_name)
            parts.push(dev.auto_name);
        return parts.join('  ·  ');
    }

    get _visibleDevices() {
        const query = this._filterText.trim().toLowerCase();
        return this._devices.filter(dev => {
            if (dev.hidden && !this._showHidden)
                return false;
            if (!query)
                return true;
            return [dev.name, dev.auto_name, dev.ip, dev.vendor, dev.model, dev.hostname, deviceKindLabel(dev),
                dev.mesh ? dev.mesh.via : ''].join(' ').toLowerCase().includes(query);
        });
    }

    // Flat list of {type: 'header', ...} and {type: 'device', dev} entries.
    get _listEntries() {
        const devs = this._visibleDevices;
        const mode = this._viewMode;
        if (mode === 'list' || this._filterText.trim() !== '')
            return devs.map(dev => ({type: 'device', dev}));
        const collapsed = this._collapsed;
        const top = [], buckets = {};
        let order = [];
        if (mode === 'ap') {
            (this._fritz.aps || []).forEach(ap => {
                order.push(ap.mac);
                buckets[ap.mac] = {
                    title: ap.name || t('accessPoint'), icon: 'network-wireless-symbolic',
                    detail: ap.role === 'master' ? t('mainRouter')
                        : ap.via ? t('viaN', [ap.via + (ap.band ? ` ${ap.band}` : '')]) : t('repeater'),
                    devs: [],
                };
            });
            order.push('none');
        } else {
            order = orderFor(mode);
        }
        devs.forEach(dev => {
            if (dev.is_gateway || (dev.is_self && mode !== 'ap')) {
                top.push(dev);
                return;
            }
            const id = mode === 'ap' ? dev.mesh && buckets[dev.mesh.via_mac] ? dev.mesh.via_mac : 'none' : this._groupOf(dev);
            if (!buckets[id]) {
                const info = groupInfo(id);
                buckets[id] = {title: info.title, icon: info.icon, detail: '', devs: []};
            }
            buckets[id].devs.push(dev);
        });
        const out = top.map(dev => ({type: 'device', dev}));
        order.forEach(id => {
            const bucket = buckets[id];
            if (!bucket || bucket.devs.length === 0)
                return;
            const isCollapsed = collapsed.includes(id);
            out.push({
                type: 'header', id, title: bucket.title, icon: bucket.icon, detail: bucket.detail,
                count: bucket.devs.length, online: bucket.devs.filter(d => d.online).length,
                hasNew: bucket.devs.some(d => d.new === true), collapsed: isCollapsed,
            });
            // The user's choice always wins; a collapsed group with a new device shows NEW on its header.
            if (!isCollapsed)
                bucket.devs.forEach(dev => out.push({type: 'device', dev, inGroup: true}));
        });
        return out;
    }

    // Tree rows for the map: {depth, guides[], last, type, ...}. guides[i] says whether the
    // ancestor at depth i+1 has siblings below, i.e. whether its vertical connector continues.
    get _mapRows() {
        const devs = this._devices.filter(d => !d.hidden);
        const collapsed = this._collapsed;
        const gateway = devs.find(d => d.is_gateway) || null;
        const apMacs = {};
        (this._fritz.aps || []).forEach(ap => (apMacs[ap.mac] = ap));
        const parentOf = dev => dev.mesh && dev.mesh.via_mac && apMacs[dev.mesh.via_mac] ? dev.mesh.via_mac : gateway ? gateway.mac : '';
        const isRepeater = d => d.kind === 'router' && !d.is_gateway && d.mesh && d.mesh.role === 'slave';
        // Under each router / repeater: its devices in the groups chosen on either page,
        // then the repeaters connected to it as their own branches.
        const apNode = (mac, dev, title) => {
            const node = {type: 'ap', id: mac, dev, title, children: []};
            const members = devs.filter(d => d !== dev && !d.is_gateway && !isRepeater(d) && parentOf(d) === mac);
            if (this._viewMode === 'list' || this._viewMode === 'ap') {
                members.forEach(d => node.children.push({type: 'device', dev: d}));
            } else {
                const buckets = {};
                members.forEach(d => {
                    const id = this._groupOf(d);
                    (buckets[id] ??= []).push(d);
                });
                orderFor(this._viewMode).forEach(id => {
                    if (!buckets[id])
                        return;
                    const info = groupInfo(id);
                    node.children.push({type: 'group', id, title: info.title, icon: info.icon, devs: buckets[id]});
                });
            }
            devs.forEach(d => {
                if (isRepeater(d) && d.mesh.via_mac === mac)
                    node.children.push(apNode(d.mac, d, d.name));
            });
            return node;
        };
        const rootNode = {type: 'internet', children: []};
        if (gateway)
            rootNode.children.push(apNode(gateway.mac, gateway, gateway.name));
        const rows = [];
        const walk = (node, depth, guides, last) => {
            const row = {depth, guides, last, type: node.type, node};
            if (node.type === 'group') {
                row.id = node.id;
                row.collapsed = collapsed.includes(node.id);
                row.count = node.devs.length;
                row.online = node.devs.filter(d => d.online).length;
            } else if (node.type === 'ap') {
                row.id = node.id;
                row.collapsed = node.dev && !node.dev.is_gateway && collapsed.includes(node.id);
            }
            rows.push(row);
            let kids = [];
            if (node.type === 'group')
                kids = row.collapsed ? [] : node.devs.map(d => ({type: 'device', dev: d}));
            else if (!row.collapsed)
                kids = node.children || [];
            const childGuides = depth > 0 ? guides.concat([!last]) : [];
            kids.forEach((child, i) => {
                if (child.type === 'device')
                    rows.push({depth: depth + 1, guides: childGuides, last: i === kids.length - 1, type: 'device', dev: child.dev});
                else
                    walk(child, depth + 1, childGuides, i === kids.length - 1);
            });
        };
        walk(rootNode, 0, [], true);
        return rows;
    }

    // ------------------------------------------------------------------ building

    _buildHero() {
        const hero = hbox({style_class: 'wlan-hero'});
        this._heroIcon = new St.Icon({gicon: this._host.gicon, style_class: 'wlan-hero-icon', y_align: Clutter.ActorAlign.CENTER});
        const text = vbox({y_align: Clutter.ActorAlign.CENTER});
        text.add_child(label('WLAN Monitor', 'wlan-title'));
        this._heroMeta = dimmed(label('', 'wlan-caption'));
        text.add_child(this._heroMeta);
        this._pill = label('', 'wlan-pill-label', {y_align: Clutter.ActorAlign.CENTER});
        hero.add_child(this._heroIcon);
        hero.add_child(text);
        hero.add_child(this._pill);
        this.actor.add_child(hero);
    }

    _buildTabs() {
        const tabs = new St.BoxLayout({style_class: 'wlan-tabs'});
        const tab = (iconName, text, map) => {
            const box = new St.BoxLayout({style_class: 'wlan-tab-box'});
            box.add_child(icon(iconName, 'wlan-tab-icon'));
            box.add_child(new St.Label({text, y_align: Clutter.ActorAlign.CENTER}));
            const button = new St.Button({child: box, style_class: 'wlan-tab', can_focus: true});
            button.connect('clicked', () => {
                if (this._mapPage !== map)
                    this._toggleGroup('mappage');
            });
            tabs.add_child(button);
            return button;
        };
        this._devicesTab = tab('view-list-symbolic', t('tabDevices'), false);
        this._mapTab = tab('network-workgroup-symbolic', t('tabMap'), true);
        this.actor.add_child(tabs);
    }

    // A VPN blocks the home network: explain why everything looks idle, and how to fix it.
    _buildVpnNotice() {
        this._vpnBox = vbox({style_class: 'wlan-notice wlan-notice-vpn'});
        const head = hbox({style_class: 'wlan-notice-head'});
        head.add_child(icon('network-vpn-symbolic'));
        this._vpnTitle = wrapping(label('', 'wlan-strong'));
        head.add_child(this._vpnTitle);
        this._vpnExplain = wrapping(dimmed(label('', 'wlan-caption')));
        this._vpnCopy = linkButton('edit-copy-symbolic', '', () => {
            if (this._host.copyText(this._vpnCommand))
                this._flash(this._vpnCopy, t('copied'), t('copyCommand', [this._vpnCommand]));
        });
        this._vpnBox.add_child(head);
        this._vpnBox.add_child(this._vpnExplain);
        this._vpnBox.add_child(this._vpnCopy);
        this.actor.add_child(this._vpnBox);
    }

    _buildDevicesPage() {
        const page = this._devicesPage = vbox({style_class: 'wlan-page'});
        page.add_child(separator());
        page.add_child(sectionHeader(t('connection')));

        const ipRow = hbox();
        this._ipText = label('', 'wlan-strong', {x_expand: true});
        this._routerText = dimmed(label('', 'wlan-caption'));
        ipRow.add_child(this._ipText);
        ipRow.add_child(this._routerText);
        page.add_child(ipRow);
        this._addressText = dimmed(label('', 'wlan-caption'));
        page.add_child(this._addressText);

        this._signalMeter = new Meter();
        this._trafficMeter = new Meter();
        page.add_child(this._signalMeter.actor);
        page.add_child(this._trafficMeter.actor);

        // Always say when a VPN is on, also when it lets the home network through.
        this._vpnLine = wrapping(label('', 'wlan-caption wlan-vpn-line'));
        page.add_child(this._vpnLine);

        // One summary line; the explanations and the FRITZ!Box login open on click,
        // so the device list keeps the space. The choice is remembered.
        const infoBox = hbox({style_class: 'wlan-info-row'});
        this._infoIcon = icon('security-low-symbolic');
        this._infoSummary = label('', 'wlan-caption', {x_expand: true});
        this._infoChevron = icon('pan-end-symbolic', 'wlan-chevron');
        infoBox.add_child(this._infoIcon);
        infoBox.add_child(this._infoSummary);
        infoBox.add_child(this._infoChevron);
        this._infoButton = new St.Button({child: infoBox, style_class: 'wlan-row-button', x_expand: true, can_focus: true});
        this._infoButton.connect('clicked', () => this._toggleGroup('showinfo'));
        page.add_child(this._infoButton);

        this._infoColumn = vbox({style_class: 'wlan-info'});
        this._trustText = wrapping(dimmed(label('', 'wlan-caption')));
        this._infoColumn.add_child(this._trustText);
        this._buildFritz(this._infoColumn);
        page.add_child(this._infoColumn);

        page.add_child(separator());
        const header = hbox();
        this._devicesHeader = label('', 'wlan-section', {x_expand: true});
        header.add_child(this._devicesHeader);
        this._listChooserButton = this._chooserButton('list');
        header.add_child(this._listChooserButton);
        this._listExpand = pillButton('list-add-symbolic', null, () => this._foldAll(false, this._listFoldIds));
        this._listCollapse = pillButton('list-remove-symbolic', null, () => this._foldAll(true, this._listFoldIds));
        this._listExpand.accessible_name = t('expandAll');
        this._listCollapse.accessible_name = t('collapseAll');
        header.add_child(this._listExpand);
        header.add_child(this._listCollapse);
        page.add_child(header);
        this._listChooser = this._chooserRow();
        page.add_child(this._listChooser);

        // New devices since the user last checked (trusted networks only).
        this._newBox = hbox({style_class: 'wlan-notice wlan-notice-new'});
        this._newText = wrapping(label('', 'wlan-caption', {x_expand: true}));
        this._newBox.add_child(icon('emblem-important-symbolic'));
        this._newBox.add_child(this._newText);
        this._newBox.add_child(linkButton('object-select-symbolic', t('allKnown'), () => this._host.send('known_all')));
        page.add_child(this._newBox);

        this._tipText = wrapping(dimmed(label(t('tip'), 'wlan-caption')));
        page.add_child(this._tipText);

        this._search = new St.Entry({
            style_class: 'wlan-entry', hint_text: t('search'), can_focus: true, x_expand: true,
            primary_icon: icon('system-search-symbolic', 'wlan-entry-icon'),
        });
        this._search.clutter_text.max_length = 40;
        this._search.clutter_text.connect('text-changed', () => {
            this._filterText = this._search.get_text();
            this._refresh();
        });
        this._onKey(this._search.clutter_text, symbol => {
            if (symbol !== Clutter.KEY_Escape || this._search.get_text() === '')
                return false;
            this._search.set_text('');
            return true;
        });
        page.add_child(this._search);

        this._fewText = wrapping(dimmed(label(t('fewDevices'), 'wlan-caption')));
        page.add_child(this._fewText);

        // Only the device list scrolls, so the link info and buttons stay visible.
        this._list = vbox({style_class: 'wlan-list'});
        this._listScroll = new St.ScrollView({
            style_class: 'wlan-scroll', hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true,
        });
        this._listScroll.child = this._list;
        page.add_child(this._listScroll);

        const footer = new St.BoxLayout({style_class: 'wlan-footer-links'});
        this._copyListButton = linkButton('edit-copy-symbolic', t('copyList'), () => this._copyList());
        this._hiddenButton = linkButton('view-reveal-symbolic', '', () => {
            this._showHidden = !this._showHidden;
            this._refresh();
        });
        footer.add_child(this._copyListButton);
        footer.add_child(this._hiddenButton);
        page.add_child(footer);
        this.actor.add_child(page);
    }

    // Optional FRITZ!Box login for mesh details (which access point, band and speed).
    _buildFritz(parent) {
        const box = this._fritzBox = vbox({style_class: 'wlan-fritz'});
        const row = new St.BoxLayout({style_class: 'wlan-footer-links'});
        this._fritzConnected = dimmed(label('', 'wlan-caption'));
        this._fritzShow = linkButton('dialog-password-symbolic', '', () => {
            this._fritzFormOpen = true;
            if (this._fritz.user && this._fritzUser.get_text() === '')
                this._fritzUser.set_text(this._fritz.user);
            this._refresh();
            const target = this._fritzUser.get_text() === '' ? this._fritzUser : this._fritzPassword;
            this._later(() => target.grab_key_focus());
        }, 'wlan-dim');
        this._fritzLogout = linkButton('view-conceal-symbolic', t('disconnect'), () => this._host.send('fritz_logout'), 'wlan-dim');
        row.add_child(this._fritzConnected);
        row.add_child(this._fritzShow);
        row.add_child(this._fritzLogout);
        box.add_child(row);
        this._fritzMessage = wrapping(label('', 'wlan-caption'));
        box.add_child(this._fritzMessage);

        const form = this._fritzForm = vbox({style_class: 'wlan-fritz-form'});
        form.add_child(wrapping(dimmed(label(t('fritzExplain'), 'wlan-caption'))));
        this._fritzUser = new St.Entry({style_class: 'wlan-entry', hint_text: t('userPlaceholder'), can_focus: true, x_expand: true});
        this._fritzUser.clutter_text.max_length = 64;
        this._fritzUser.clutter_text.connect('activate', () => this._fritzPassword.grab_key_focus());
        this._onKey(this._fritzUser.clutter_text, symbol => {
            if (symbol === Clutter.KEY_Escape) {
                this._closeFritzForm();
                return true;
            }
            if (symbol === Clutter.KEY_Tab) {
                this._fritzPassword.grab_key_focus();
                return true;
            }
            return false;
        });
        form.add_child(this._fritzUser);
        const helpButton = linkButton('pan-end-symbolic', t('whereFind'), () => {
            this._fritzHelpOpen = !this._fritzHelpOpen;
            this._refresh();
        }, 'wlan-dim');
        this._fritzHelpButton = helpButton;
        form.add_child(helpButton);
        this._fritzHelp = wrapping(dimmed(label(t('fritzHelp'), 'wlan-caption wlan-indented')));
        form.add_child(this._fritzHelp);
        // The password goes to the collector over its stdin pipe and is never shown again.
        this._fritzPassword = new St.PasswordEntry({style_class: 'wlan-entry', hint_text: t('password'), can_focus: true, x_expand: true});
        this._fritzPassword.clutter_text.max_length = 128;
        this._fritzPassword.clutter_text.connect('activate', () => this._fritzConnect());
        this._fritzPassword.clutter_text.connect('text-changed', () => setSensitive(this._fritzConnectButton, this._fritzPassword.get_text() !== ''));
        this._onKey(this._fritzPassword.clutter_text, symbol => {
            if (symbol !== Clutter.KEY_Escape)
                return false;
            this._closeFritzForm();
            return true;
        });
        form.add_child(this._fritzPassword);
        const buttons = new St.BoxLayout({style_class: 'wlan-buttons'});
        this._fritzConnectButton = pillButton('dialog-password-symbolic', t('connect'), () => this._fritzConnect());
        setSensitive(this._fritzConnectButton, false);
        buttons.add_child(this._fritzConnectButton);
        buttons.add_child(pillButton(null, t('cancel'), () => this._closeFritzForm()));
        form.add_child(buttons);
        box.add_child(form);
        parent.add_child(box);
    }

    _fritzConnect() {
        const password = this._fritzPassword.get_text();
        if (password === '')
            return;
        this._host.sendJson({cmd: 'fritz_login', user: this._fritzUser.get_text().trim(), password});
        this._closeFritzForm();
    }

    _closeFritzForm() {
        this._fritzPassword.set_text('');
        this._fritzFormOpen = false;
        this._refresh();
    }

    _buildMapPage() {
        const page = this._mapPageBox = vbox({style_class: 'wlan-page'});
        page.add_child(separator());
        const header = hbox();
        this._mapSummary = dimmed(label('', 'wlan-caption', {x_expand: true}));
        header.add_child(this._mapSummary);
        this._mapChooserButton = this._chooserButton('map');
        header.add_child(this._mapChooserButton);
        this._mapExpand = pillButton('list-add-symbolic', null, () => this._foldAll(false, this._mapFoldIds));
        this._mapCollapse = pillButton('list-remove-symbolic', null, () => this._foldAll(true, this._mapFoldIds));
        this._mapExpand.accessible_name = t('expandAll');
        this._mapCollapse.accessible_name = t('collapseAll');
        header.add_child(this._mapExpand);
        header.add_child(this._mapCollapse);
        page.add_child(header);
        this._mapChooser = this._chooserRow();
        page.add_child(this._mapChooser);
        this._map = vbox({style_class: 'wlan-map'});
        this._mapScroll = new St.ScrollView({
            style_class: 'wlan-scroll', hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true,
        });
        this._mapScroll.child = this._map;
        page.add_child(this._mapScroll);
        this._mapBandNote = wrapping(dimmed(label('', 'wlan-caption')));
        page.add_child(this._mapBandNote);
        page.add_child(wrapping(dimmed(label(t('mapTip'), 'wlan-caption'))));
        this.actor.add_child(page);
    }

    // Grouping choice, shared by both pages: a button with the current choice; a click
    // shows the choices in a row below (a popup menu inside the menu is not possible).
    _chooserButton(page) {
        const box = new St.BoxLayout({style_class: 'wlan-pill-box'});
        const text = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        box.add_child(text);
        box.add_child(icon('pan-down-symbolic', 'wlan-pill-icon'));
        const button = new St.Button({child: box, style_class: 'wlan-pill', can_focus: true});
        button._label = text;
        button.connect('clicked', () => {
            this._chooser = this._chooser === page ? '' : page;
            this._refresh();
        });
        return button;
    }

    _chooserRow() {
        return new St.BoxLayout({style_class: 'wlan-chooser'});
    }

    _fillChooser(row) {
        row.destroy_all_children();
        for (const mode of this._viewModes) {
            const button = new St.Button({label: t(VIEW_SHORT[mode]), style_class: 'wlan-chip', can_focus: true});
            if (mode === this._viewMode)
                button.add_style_pseudo_class('checked');
            button.connect('clicked', () => this._setViewMode(mode));
            row.add_child(button);
        }
    }

    _buildFooter() {
        const row = this._footer = new St.BoxLayout({style_class: 'wlan-buttons'});
        this._rescanButton = pillButton('view-refresh-symbolic', t('rescan'), () => this._host.rescan());
        this._routerButton = pillButton('network-wireless-symbolic', t('kRouter'), () => {
            if (this._gatewayDevice)
                this._host.openWeb(this._gatewayDevice.web_url);
        });
        this._trustButton = pillButton('security-high-symbolic', '', () => this._host.setTrusted(!this._trusted));
        const wifi = pillButton('network-wireless-symbolic', null, () => this._host.openWifiSettings());
        wifi.accessible_name = t('wifiTip');
        row.add_child(this._rescanButton);
        row.add_child(this._routerButton);
        row.add_child(this._trustButton);
        row.add_child(wifi);
        this.actor.add_child(row);
    }

    // ------------------------------------------------------------------ updates

    update(stats) {
        this.stats = stats || {};
        // A stored view from the collector replaces the local copy once it caught up.
        if (this._localView && this.stats.view && JSON.stringify(this.stats.view) === JSON.stringify(this._localView))
            this._localView = null;
        // Only replace the device list when its content changed, and never while a name
        // is being edited (a rebuild would drop the text field).
        if (this._editingKey === '') {
            const rev = String(this.stats.devices_rev || '');
            if (rev === '' || rev !== this._devicesRev) {
                this._devicesRev = rev;
                this._devices = this.stats.devices || [];
            }
        }
        this._refresh();
    }

    _refresh() {
        const stats = this.stats;
        const link = this._link;
        const active = stats.active === true;
        const total = Number(stats.total_count || 0);
        const online = Number(stats.online_count || 0);
        const hidden = Number(stats.hidden_count || 0);
        const newCount = Number(stats.new_count || 0);
        const mapPage = this._mapPage;

        this._heroIcon.opacity = active ? 255 : DIM;
        this._heroMeta.text = active && link.ssid
            ? link.ssid + (link.band ? ` · ${link.band}` : '') + (link.width_mhz ? ` (${link.width_mhz} MHz)` : '')
            : t('notConnected');
        this._pill.text = active ? t('onlineN', [online]) : '';
        this._pill.visible = active;

        this._setChecked(this._devicesTab, !mapPage);
        this._setChecked(this._mapTab, mapPage);

        const vpn = this._vpn;
        this._vpnBox.visible = this._lanBlocked;
        if (this._lanBlocked) {
            this._vpnTitle.text = t('vpnBlocks', [vpn.name || t('aVpn')]);
            this._vpnExplain.text = `${t('vpnExplain')} ${this._vpnHint.replace(/([^.])$/, '$1.')} ${t('disconnectVpn')}`;
            this._vpnCopy.visible = this._vpnCommand !== '';
            if (!this._vpnCopy._flashing)
                this._vpnCopy._label.text = t('copyCommand', [this._vpnCommand]);
        }

        this._devicesPage.visible = !mapPage;
        this._mapPageBox.visible = mapPage;
        if (mapPage)
            this._refreshMap(total);
        else
            this._refreshDevices(active, total, hidden, newCount);

        // Footer: rescan, router page, trust, Wi-Fi settings.
        const scanning = this._host.scanning;
        setSensitive(this._rescanButton, !scanning);
        this._rescanButton.opacity = scanning ? 140 : 255;
        const gw = this._gatewayDevice;
        this._routerButton.visible = gw !== null && String(gw.web_url || '') !== '';
        this._trustButton.visible = active;
        setSensitive(this._trustButton, link.can_trust === true);
        this._trustButton.child.get_last_child().text = this._trusted ? t('untrust') : t('trust');
        this._trustButton.child.get_first_child().icon_name = this._trusted ? 'security-low-symbolic' : 'security-high-symbolic';
    }

    _setChecked(button, on) {
        if (on)
            button.add_style_pseudo_class('checked');
        else
            button.remove_style_pseudo_class('checked');
    }

    _refreshDevices(active, total, hidden, newCount) {
        const link = this._link;
        const traffic = this.stats.traffic || {};
        this._ipText.text = `${t('thisPc')}  ${link.ip || '—'}`;
        this._routerText.text = link.gateway ? `${t('router')}  ${link.gateway}` : '';
        this._addressText.visible = active;
        this._addressText.text = [t('addressOn', [link.cidr || link.ip || '—', link.iface || '?']),
            link.mac ? t('macN', [link.mac]) : '', link.domain ? t('localDomain', [link.domain]) : '']
            .filter(Boolean).join('  ·  ');

        const hasQuality = link.quality !== null && link.quality !== undefined;
        this._signalMeter.actor.visible = hasQuality;
        if (hasQuality) {
            const fraction = Math.max(0, Math.min(1, Number(link.quality || 0) / 100));
            const tip = [link.signal_dbm !== null && link.signal_dbm !== undefined ? `${link.signal_dbm} dBm` : '',
                link.channel ? t('channelN', [link.channel]) : '',
                link.tx_mbps ? t('linkN', [link.tx_mbps + (link.rx_mbps ? ` / ${link.rx_mbps}` : '')]) : '']
                .filter(Boolean).join('  ·  ');
            this._signalMeter.update(`${t('signal')}  ·  ${signalWord(link.quality)}`, `${link.quality || 0} %`, fraction,
                signalColor(fraction), `${tip}\n${t('signalScale')}\n${t('signalWeakTip')}`);
        }
        const rate = Number(traffic.rx_rate || 0) + Number(traffic.tx_rate || 0);
        this._trafficMeter.update(t('trafficNow'),
            `↓ ${formatRate(traffic.rx_rate)}  ·  ↑ ${formatRate(traffic.tx_rate)}`,
            rate <= 0 ? 0 : Math.min(1, Math.log10(1 + rate / 1024) / 4), null,
            t('trafficTip', [formatBytes(traffic.rx_bytes), formatBytes(traffic.tx_bytes)]));

        const vpn = this._vpn;
        this._vpnLine.visible = vpn !== null;
        if (vpn)
            this._vpnLine.text = `${t('vpnOn', [vpn.name || ''])}  ·  ${t(this._lanBlocked ? 'blocksHome' : 'homeReachable')}`;

        this._infoButton.visible = active;
        this._infoIcon.icon_name = this._trusted ? 'security-high-symbolic' : 'security-low-symbolic';
        this._infoSummary.text = (this._trusted ? t('yourNetwork') : t('notYourNetwork')) +
            (link.via ? `  ·  ${t('viaN', [String(link.via).replace(/^Router \((.*)\)$/, '$1')])}${link.via_band ? ` · ${link.via_band}` : ''}` : '');
        this._infoChevron.icon_name = this._infoOpen ? 'pan-down-symbolic' : 'pan-end-symbolic';
        const fritz = this._fritz;
        this._infoColumn.visible = this._infoOpen || this._fritzFormOpen || fritz.state === 'error' || fritz.state === 'connecting';
        this._trustText.visible = active;
        this._trustText.text = this._trusted
            ? t(this.stats.alerts !== false ? 'trustedAlertsOn' : 'trustedAlertsOff')
            : t('untrustedInfo');
        this._refreshFritz();

        this._devicesHeader.text = t('devicesN', [total]).toUpperCase();
        this._listChooserButton._label.text = t(VIEW_SHORT[this._viewMode] || 'shortList');
        const foldable = this._viewMode !== 'list' && this._filterText === '';
        setSensitive(this._listExpand, foldable);
        setSensitive(this._listCollapse, foldable);
        this._listChooser.visible = this._chooser === 'list';
        if (this._chooser === 'list')
            this._fillChooser(this._listChooser);

        this._newBox.visible = newCount > 0;
        this._newText.text = `${tn('newJoined', newCount)}. ${t('notYours')}`;
        this._tipText.visible = Number(this.stats.named_count || 0) === 0 && this._devices.length > 1 && newCount === 0;
        this._search.visible = total - hidden > 12 || this._filterText !== '';
        this._fewText.visible = active && !this._trusted && total <= 3;
        this._copyListButton.visible = this._devices.length > 0;
        this._hiddenButton.visible = hidden > 0;
        this._hiddenButton._label.text = t(this._showHidden ? 'hideHidden' : 'showHidden', [hidden]);
        this._hiddenButton._icon.icon_name = this._showHidden ? 'view-conceal-symbolic' : 'view-reveal-symbolic';

        const signature = JSON.stringify([this._devicesRev, this._view, this._filterText, this._showHidden,
            this._expandedKey, this._editingKey, this._meshActive, (this._fritz.aps || []).map(ap => [ap.mac, ap.name, ap.role, ap.via, ap.band]),
            this._devices.length]);
        if (signature !== this._listSignature) {
            this._listSignature = signature;
            this._rebuildList();
        }
    }

    _refreshFritz() {
        const fritz = this._fritz;
        this._fritzBox.visible = fritz.available === true;
        if (!this._fritzBox.visible)
            return;
        this._fritzConnected.visible = fritz.state === 'connected';
        this._fritzConnected.text = tn('fritzConnected', (fritz.aps || []).length);
        this._fritzShow.visible = fritz.state !== 'connected' && fritz.state !== 'connecting' && !this._fritzFormOpen;
        this._fritzShow._label.text = fritz.state === 'error' && fritz.user ? t('fritzReconnect') : t('fritzShow');
        this._fritzLogout.visible = fritz.user !== undefined && fritz.user !== '' && !this._fritzFormOpen;
        const message = fritz.message_code ? t(fritz.message_code, fritz.message_args || []) : String(fritz.message || '');
        this._fritzMessage.visible = (fritz.state === 'error' || fritz.state === 'connecting') && String(fritz.message || '') !== '';
        this._fritzMessage.text = message;
        if (fritz.state === 'error')
            this._fritzMessage.add_style_class_name('wlan-accent');
        else
            this._fritzMessage.remove_style_class_name('wlan-accent');
        this._fritzForm.visible = this._fritzFormOpen;
        this._fritzHelp.visible = this._fritzHelpOpen;
        this._fritzHelpButton._icon.icon_name = this._fritzHelpOpen ? 'pan-down-symbolic' : 'pan-end-symbolic';
    }

    _rebuildList() {
        this._list.destroy_all_children();
        const entries = this._listEntries;
        for (const entry of entries) {
            const actor = entry.type === 'header' ? this._groupHeader(entry) : this._deviceRow(entry.dev);
            if (entry.inGroup)
                actor.add_style_class_name('wlan-in-group');
            this._list.add_child(actor);
        }
        if (entries.length === 0 && this._filterText !== '')
            this._list.add_child(dimmed(label(t('noMatch', [this._filterText]), 'wlan-caption')));
    }

    _groupHeader(group) {
        const box = hbox({style_class: 'wlan-group-box'});
        const glyph = icon(group.icon || 'dialog-question-symbolic');
        if (group.online > 0)
            glyph.add_style_class_name('wlan-accent');
        else
            dimmed(glyph);
        box.add_child(glyph);
        box.add_child(label(group.title + (group.detail ? `  ·  ${group.detail}` : ''), 'wlan-group-title', {x_expand: true}));
        const count = label((group.hasNew ? `${t('newBadge')}  ` : '') + group.count +
            (group.online !== group.count ? ` · ${t('onlineN', [group.online])}` : ''), 'wlan-caption');
        if (group.hasNew)
            count.add_style_class_name('wlan-accent');
        else
            dimmed(count);
        box.add_child(count);
        box.add_child(dimmed(icon(group.collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic', 'wlan-chevron')));
        const button = new St.Button({child: box, style_class: 'wlan-group', x_expand: true, can_focus: true});
        button.connect('clicked', () => this._toggleGroup(group.id));
        return button;
    }

    // One device row; a click on it toggles the details.
    _deviceRow(dev) {
        const key = deviceKey(dev);
        const online = dev.online === true;
        const expanded = this._expandedKey === key;
        const editing = this._editingKey === key && dev.can_edit === true;
        const webUrl = String(dev.web_url || '');
        const block = vbox({style_class: 'wlan-device'});
        if (expanded)
            block.add_style_pseudo_class('checked');

        const top = hbox();
        const main = hbox({style_class: 'wlan-device-main'});
        const kind = icon(kindIcon(dev.kind));
        if (online)
            kind.add_style_class_name('wlan-accent');
        else
            dimmed(kind);
        let nameField = null;
        if (editing) {
            nameField = new St.Entry({style_class: 'wlan-entry', text: dev.name, hint_text: dev.auto_name || t('deviceName'), can_focus: true, x_expand: true});
            nameField.clutter_text.max_length = 40;
            nameField.clutter_text.connect('activate', () => this._finishRename(dev, nameField.get_text()));
            this._onKey(nameField.clutter_text, symbol => {
                if (symbol !== Clutter.KEY_Escape)
                    return false;
                this._finishRename(null, null);
                return true;
            });
            top.add_child(kind);
            top.add_child(nameField);
        } else {
            main.add_child(kind);
            const name = label(dev.name, online ? 'wlan-device-name wlan-strong' : 'wlan-device-name', {x_expand: true});
            if (!online)
                dimmed(name);
            if (dev.hidden)
                name.add_style_class_name('wlan-italic');
            main.add_child(name);
            if (dev.new === true)
                main.add_child(label(t('newBadge'), 'wlan-caption wlan-accent wlan-strong'));
            if (dev.pinned === true)
                main.add_child(dimmed(icon('view-pin-symbolic', 'wlan-small-icon')));
            const right = label(this._deviceRightLabel(dev), 'wlan-caption');
            if (dev.is_gateway || dev.is_self)
                right.add_style_class_name('wlan-accent');
            else if (!online)
                dimmed(right);
            main.add_child(right);
            block._right = right;
            const mainButton = new St.Button({child: main, style_class: 'wlan-row-button', x_expand: true, can_focus: true});
            mainButton.connect('clicked', () => {
                this._editingKey = '';
                this._expandedKey = expanded ? '' : key;
                this._refresh();
            });
            top.add_child(mainButton);
            if (webUrl !== '') {
                const web = new St.Button({child: icon('web-browser-symbolic', 'wlan-small-icon'), style_class: 'wlan-icon-button', can_focus: true});
                web.accessible_name = t('openUrl', [webUrl]);
                web.connect('clicked', () => this._host.openWeb(webUrl));
                top.add_child(web);
            }
            if (String(dev.ip || '') !== '') {
                const copyIcon = icon('edit-copy-symbolic', 'wlan-small-icon');
                const copy = new St.Button({child: copyIcon, style_class: 'wlan-icon-button', can_focus: true});
                copy.accessible_name = t('copyIp');
                copy.connect('clicked', () => {
                    if (!isIpv4(dev.ip) || !this._host.copyText(dev.ip))
                        return;
                    copyIcon.icon_name = 'object-select-symbolic';
                    right.text = t('copiedClipboard');
                    this._timeout(1400, () => {
                        copyIcon.icon_name = 'edit-copy-symbolic';
                        right.text = this._deviceRightLabel(dev);
                    }, block);
                });
                top.add_child(copy);
            }
        }
        block.add_child(top);

        const subtitle = editing ? t('editHint') : this._deviceSubtitle(dev);
        if (subtitle)
            block.add_child(dimmed(label(subtitle, 'wlan-caption wlan-indented')));

        // Expanded details: what the device is, in plain words, plus actions.
        if (expanded) {
            const details = vbox({style_class: 'wlan-details wlan-indented'});
            details.add_child(wrapping(label(statusExplain(dev), 'wlan-caption')));
            [
                [t('dConnectedVia'), dev.mesh && dev.mesh.via && !dev.is_gateway ? dev.mesh.via : ''],
                [t('dConnection'), this._meshDetail(dev)],
                [t('dMaker'), dev.vendor === 'Private MAC' ? t('dMakerHidden') : dev.vendor],
                [t('dModel'), dev.model],
                [t('dAutoName'), dev.custom_name ? dev.auto_name : ''],
                [t('dNetworkName'), dev.hostname && dev.hostname !== dev.name ? dev.hostname : ''],
                [t('dIp'), dev.ip],
                [t('dMac'), dev.mac],
            ].filter(item => item[1]).forEach(([name, value]) => {
                details.add_child(wrapping(dimmed(label(`${name}:  ${value}`, 'wlan-caption'))));
            });
            const actions = new St.BoxLayout({style_class: 'wlan-actions'});
            const editable = dev.can_edit === true && !dev.is_gateway && !dev.is_self;
            if (dev.can_edit === true && !editing)
                actions.add_child(linkButton('document-edit-symbolic', t('rename'), () => this._startRename(dev)));
            if (editing)
                actions.add_child(linkButton('object-select-symbolic', t('save'), () => this._finishRename(dev, nameField.get_text())));
            if (editable && !editing) {
                actions.add_child(linkButton('view-pin-symbolic', dev.pinned ? t('unpin') : t('pinTop'),
                    () => this._deviceCommand('pin', dev, {on: !dev.pinned})));
                actions.add_child(linkButton(dev.hidden ? 'view-reveal-symbolic' : 'view-conceal-symbolic', dev.hidden ? t('show') : t('hide'), () => {
                    this._deviceCommand('hide', dev, {on: !dev.hidden});
                    if (!dev.hidden)
                        this._expandedKey = '';
                    this._refresh();
                }));
            }
            if (webUrl !== '' && !editing)
                actions.add_child(linkButton('web-browser-symbolic', t('openWeb'), () => this._host.openWeb(webUrl)));
            if (dev.new === true && !editing)
                actions.add_child(linkButton('object-select-symbolic', t('itsMine'), () => this._deviceCommand('known', dev, {on: true})));
            details.add_child(actions);
            if (dev.can_edit !== true)
                details.add_child(wrapping(dimmed(label(t('noMac'), 'wlan-caption'))));
            block.add_child(details);
        }
        if (nameField) {
            this._later(() => {
                if (nameField.get_stage()) {
                    nameField.grab_key_focus();
                    nameField.clutter_text.set_selection(0, -1);
                }
            });
        }
        return block;
    }

    _deviceCommand(cmd, dev, extra) {
        if (!dev || !dev.can_edit)
            return;
        this._host.sendJson({cmd, mac: String(dev.mac || ''), ...extra});
    }

    _startRename(dev) {
        this._expandedKey = deviceKey(dev);
        this._editingKey = deviceKey(dev);
        this._refresh();
    }

    _finishRename(dev, name) {
        if (dev && name !== null)
            this._deviceCommand('rename', dev, {name: String(name).trim().slice(0, 40)});
        this._editingKey = '';
        // The list was frozen while editing: take the newest one now.
        this._devicesRev = '';
        this.update(this.stats);
    }

    // From the map: back to the Devices page, open the device's group, expand and show it.
    _openDevice(dev) {
        const drop = ['mappage', this._groupIdOf(dev)];
        if (dev.hidden)
            this._showHidden = true;
        this._filterText = '';
        this._search.set_text('');
        this._expandedKey = deviceKey(dev);
        this._saveView(this._viewMode, this._collapsed.filter(id => !drop.includes(id)));
    }

    _refreshMap(total) {
        const n = this._devices.filter(d => !d.hidden && !d.is_gateway).length;
        this._mapSummary.text = tn('devices', n);
        this._mapChooserButton._label.text = t(VIEW_SHORT[this._viewMode] || 'shortList');
        const usable = this._viewMode !== 'list' && this._viewMode !== 'ap';
        setSensitive(this._mapExpand, usable);
        setSensitive(this._mapCollapse, usable);
        this._mapChooser.visible = this._chooser === 'map';
        if (this._chooser === 'map')
            this._fillChooser(this._mapChooser);
        this._mapBandNote.visible = !this._meshActive;
        this._mapBandNote.text = this._fritz.available === true ? t('connectFritzForBand') : t('bandForFritz');
        const signature = JSON.stringify([this._devicesRev, this._view, this._meshActive, this._vpn ? this._vpn.name : '',
            (this._fritz.aps || []).map(ap => [ap.mac, ap.role]), total]);
        if (signature === this._mapSignature)
            return;
        this._mapSignature = signature;
        this._map.destroy_all_children();
        for (const row of this._mapRows)
            this._map.add_child(this._mapRow(row));
    }

    // One row of the network map with its tree connectors.
    _mapRow(row) {
        const depth = row.depth || 0;
        const dev = row.type === 'device' ? row.dev : row.node && row.node.dev ? row.node.dev : null;
        const online = row.type === 'device' ? dev && dev.online === true : row.type === 'group' ? row.online > 0 : true;
        const height = row.type === 'group' || row.type === 'device' ? 26 : 32;
        const box = hbox({style_class: 'wlan-map-row', style: `height: ${height}px;`});

        // Connectors: the ancestors' verticals that continue, then this row's elbow.
        const lines = new St.Widget({layout_manager: new Clutter.FixedLayout(), width: depth * MAP_INDENT, height});
        (row.guides || []).forEach((on, i) => {
            if (on)
                lines.add_child(new St.Widget({style_class: 'wlan-map-line', x: i * MAP_INDENT + MAP_INDENT / 2, y: 0, width: 1, height}));
        });
        if (depth > 0) {
            const x = (depth - 1) * MAP_INDENT + MAP_INDENT / 2;
            lines.add_child(new St.Widget({style_class: 'wlan-map-line', x, y: 0, width: 1, height: row.last ? height / 2 : height}));
            lines.add_child(new St.Widget({style_class: 'wlan-map-line', x, y: height / 2, width: MAP_INDENT / 2 + 2, height: 1}));
        }
        box.add_child(lines);

        const content = hbox({style_class: 'wlan-map-node'});
        const big = row.type === 'internet' || row.type === 'ap';
        let iconName;
        if (row.type === 'internet')
            iconName = 'web-browser-symbolic';
        else if (row.type === 'ap')
            iconName = kindIcon('router');
        else if (row.type === 'group')
            iconName = row.node.icon || 'dialog-question-symbolic';
        else
            iconName = kindIcon(dev ? dev.kind : 'unknown');
        const glyph = icon(iconName, big ? 'wlan-map-icon wlan-map-icon-big' : 'wlan-map-icon');
        if (online)
            glyph.add_style_class_name('wlan-map-online');
        content.add_child(glyph);

        let text;
        if (row.type === 'internet')
            text = t('internet') + (this._vpn ? `  ·  ${t('viaN', [this._vpn.name])}` : '');
        else if (row.type === 'ap')
            text = (row.node.title || t('kRouter')) + (row.node.dev && row.node.dev.is_gateway && row.node.dev.model ? `  ·  ${row.node.dev.model}` : '');
        else if (row.type === 'group')
            text = `${row.node.title}  ·  ${tn('devices', row.count)}`;
        else
            text = dev ? dev.name : '';
        const name = label(text, row.type === 'device' ? 'wlan-caption' : 'wlan-group-title', {x_expand: true});
        if (row.type !== 'device' || (dev && dev.is_self))
            name.add_style_class_name('wlan-strong');
        if (!online)
            dimmed(name);
        content.add_child(name);

        if (row.type === 'device' && dev) {
            if (dev.new)
                content.add_child(label(t('newBadge'), 'wlan-caption wlan-accent wlan-strong'));
            const detail = dev.mesh && dev.mesh.rate_mbps ? `${dev.mesh.rate_mbps} Mbit/s` : !dev.online ? statusWord(dev) : '';
            if (detail)
                content.add_child(dimmed(label(detail, 'wlan-caption')));
            const quality = dev.mesh ? signalQuality(dev.mesh.signal_dbm) : -1;
            if (quality >= 0)
                content.add_child(signalBars(quality));
        }

        const clickable = row.type === 'device' || row.type === 'group' || row.type === 'ap';
        let main = content;
        if (clickable) {
            main = new St.Button({child: content, style_class: 'wlan-row-button', x_expand: true, can_focus: true});
            main.connect('clicked', () => {
                if (row.type === 'device' && dev)
                    this._openDevice(dev);
                else if (row.type === 'group' || (row.type === 'ap' && dev && !dev.is_gateway))
                    this._toggleGroup(row.id);
                else if (row.type === 'ap' && dev)
                    this._openDevice(dev);
            });
        }
        box.add_child(main);

        // Copy the IP address, as on the Devices page.
        if (dev && String(dev.ip || '') !== '' && row.type !== 'group') {
            const copyIcon = icon('edit-copy-symbolic', 'wlan-small-icon');
            const copy = new St.Button({child: copyIcon, style_class: 'wlan-icon-button', can_focus: true, y_align: Clutter.ActorAlign.CENTER});
            copy.accessible_name = t('copyIpN', [dev.ip]);
            copy.connect('clicked', () => {
                if (!isIpv4(dev.ip) || !this._host.copyText(dev.ip))
                    return;
                copyIcon.icon_name = 'object-select-symbolic';
                this._timeout(1400, () => (copyIcon.icon_name = 'edit-copy-symbolic'), copy);
            });
            box.add_child(copy);
        }
        if (row.type === 'group' || (row.type === 'ap' && dev && !dev.is_gateway))
            box.add_child(dimmed(icon(row.collapsed ? 'pan-end-symbolic' : 'pan-down-symbolic', 'wlan-chevron')));
        return box;
    }

    // The device list as a Markdown table on the clipboard (text from the collector is
    // already sanitized; `|` is replaced so cells stay intact).
    _copyList() {
        const cell = value => String(value || '').replace(/[|\r\n]/g, ' ').trim();
        const now = GLib.DateTime.new_now_local().format('%x %X');
        const lines = [
            `# Devices on ${cell(this._link.ssid || 'the network')} (${now})`,
            '',
            `| ${[t('colName'), t('colType'), t('colStatus'), 'IP', t('colMaker'), t('colModel'), 'MAC'].join(' | ')} |`,
            '| --- | --- | --- | --- | --- | --- | --- |',
        ];
        this._devices.slice(0, 256).forEach(dev => {
            lines.push(`| ${[dev.name, kindLabel(dev.kind), statusWord(dev) + (dev.hidden ? ` ${t('hiddenMark')}` : ''),
                dev.ip, dev.vendor, dev.model, dev.mac].map(cell).join(' | ')} |`);
        });
        if (this._host.copyText(`${lines.join('\n')}\n`))
            this._flash(this._copyListButton, t('copied'), t('copyList'));
    }

    // ------------------------------------------------------------------ helpers

    _flash(button, text, back) {
        button._label.text = text;
        button._flashing = true;
        this._timeout(1600, () => {
            button._flashing = false;
            button._label.text = back;
        }, button);
    }

    _onKey(actor, handler) {
        const controller = new Clutter.KeyController();
        controller.connect('key-press', () => {
            const [, symbol] = controller.get_key();
            return handler(symbol) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        actor.add_action(controller);
    }

    // A one-shot timeout that is removed with the panel (or with `owner`).
    _timeout(ms, fn, owner = null) {
        if (owner && !owner._wlanWatched) {
            owner._wlanWatched = true;
            owner.connect('destroy', () => (owner._wlanGone = true));
        }
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            if (!owner || !owner._wlanGone)
                fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
    }

    _later(fn) {
        this._timeout(0, fn);
    }

    _clearTimeouts() {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
    }

    // The menu opened: keyboard focus to the panel, '/' focuses the search.
    focusSearch() {
        if (this._search.visible && !this._mapPage) {
            this._search.grab_key_focus();
            return true;
        }
        return false;
    }

    get editing() {
        return this._editingKey !== '';
    }

    menuClosed() {
        this._chooser = '';
        if (this._editingKey !== '') {
            this._editingKey = '';
            this._devicesRev = '';
        }
        this._fritzFormOpen = false;
        this._fritzPassword.set_text('');
        this._listSignature = null;
        this._mapSignature = null;
    }

    setListHeight(maxHeight) {
        this._listScroll.style = `max-height: ${maxHeight}px;`;
        this._mapScroll.style = `max-height: ${maxHeight + 120}px;`;
    }
}

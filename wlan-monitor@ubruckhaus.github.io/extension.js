// WLAN Monitor for GNOME: a top bar indicator for the local WLAN. Dim radar icon
// while disconnected; green while connected, blue while a VPN is active, with a thin
// signal-quality bar underneath. It pulses while the subnet is being scanned, and a
// dot marks devices that joined recently. Left click opens the panel, right click
// rescans at once.
//
// The data comes from scripts/wlan-monitor.py, which streams a JSON snapshot every
// 3 s while the panel is open (6 s while closed). Commands (rescan, panel open/closed,
// trust/untrust, per-device rename / pin / hide as one-line JSON) go to it over stdin.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {COLORS, WlanPanel, isWebUrl, signalColor} from './panel.js';
import {t} from './strings.js';

const RESTART_DELAY = 5;          // seconds before a collector that exited starts again
const DIM = 150;
const CLIPBOARD_LIMIT = 262144;

// ---------------------------------------------------------------------------------- collector

class Collector {
    constructor(script, onLine) {
        this._script = script;
        this._onLine = onLine;
        this._stopped = false;
        this._queue = [];
        this._writing = false;
        this.onStart = null;
        this.onExit = null;
    }

    start() {
        this._cancellable = new Gio.Cancellable();
        const python = GLib.find_program_in_path('python3');
        try {
            if (!python)
                throw new Error('python3 not found');
            this._proc = Gio.Subprocess.new([python, '-I', this._script],
                Gio.SubprocessFlags.STDIN_PIPE | Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.error(`[WLAN Monitor] collector did not start: ${e.message}`);
            this._restartLater();
            return;
        }
        this._stdin = this._proc.get_stdin_pipe();
        this._queue = [];
        this._writing = false;
        const stream = new Gio.DataInputStream({base_stream: this._proc.get_stdout_pipe(), close_base_stream: true});
        this._readLine(stream, this._cancellable);
        this._proc.wait_async(this._cancellable, (proc, result) => {
            try {
                proc.wait_finish(result);
            } catch {
                return;     // cancelled: stop() was called
            }
            this._stdin = null;
            this.onExit?.();
            this._restartLater();
        });
        this.onStart?.();
    }

    // One command per line; queued so writes never overlap.
    send(line) {
        if (!this._stdin || this._stopped)
            return;
        this._queue.push(new TextEncoder().encode(`${line}\n`));
        this._flush();
    }

    _flush() {
        if (this._writing || !this._stdin || this._queue.length === 0)
            return;
        this._writing = true;
        const stdin = this._stdin;
        stdin.write_all_async(this._queue.shift(), GLib.PRIORITY_DEFAULT, this._cancellable, (s, result) => {
            try {
                s.write_all_finish(result);
            } catch {
                this._queue = [];   // the collector went away; it starts again by itself
            }
            this._writing = false;
            if (stdin === this._stdin)
                this._flush();
        });
    }

    _readLine(stream, cancellable) {
        stream.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (s, result) => {
            let line;
            try {
                [line] = s.read_line_finish_utf8(result);
            } catch {
                return;     // cancelled or the pipe closed
            }
            if (line === null)
                return;
            try {
                this._onLine(JSON.parse(line));
            } catch {
                // a partial line while the collector exits
            }
            this._readLine(s, cancellable);
        });
    }

    _restartLater() {
        if (this._stopped || this._restartId)
            return;
        this._restartId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, RESTART_DELAY, () => {
            this._restartId = 0;
            if (!this._stopped)
                this.start();
            return GLib.SOURCE_REMOVE;
        });
    }

    stop() {
        this._stopped = true;
        if (this._restartId)
            GLib.source_remove(this._restartId);
        this._restartId = 0;
        this._cancellable?.cancel();
        this._proc?.force_exit();
        this._proc = null;
        this._stdin = null;
        this._queue = [];
    }
}

// ---------------------------------------------------------------------------------- indicator

const Indicator = GObject.registerClass(
class WlanMonitorIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.5, 'WLAN Monitor', false);
        this._extension = extension;
        this._stats = {};
        this._scanBusy = false;       // the collector reported that a sweep is running
        this._rescanPending = false;  // the user asked for a rescan, waiting for the result
        this.add_style_class_name('wlan-monitor-button');

        // Only the left button opens the menu; the right one rescans.
        this._clickGesture.set_required_button(Clutter.BUTTON_PRIMARY);
        const rightClick = new Clutter.ClickGesture({required_button: Clutter.BUTTON_SECONDARY});
        rightClick.set_recognize_on_press(true);
        rightClick.connect('recognize', () => this.rescan());
        this.add_action(rightClick);

        this._gicon = Gio.FileIcon.new(extension.dir.get_child('icons').get_child('wlan-radar-symbolic.svg'));
        const stack = new St.Widget({layout_manager: new Clutter.BinLayout(), y_expand: true});
        this._icon = new St.Icon({gicon: this._gicon, style_class: 'system-status-icon wlan-bar-icon', y_align: Clutter.ActorAlign.CENTER});
        // Dot: devices joined recently and are not marked as known yet.
        this._dot = new St.Widget({
            style_class: 'wlan-new-dot', x_expand: true, y_expand: true,
            x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START, visible: false,
        });
        // Signal quality under the icon: grows with the Wi-Fi signal, coloured by level.
        this._line = new St.BoxLayout({style_class: 'wlan-bar-line', x_expand: true, y_align: Clutter.ActorAlign.END});
        this._lineFill = new St.Widget({y_expand: true});
        this._line.add_child(this._lineFill);
        this._line.connect('notify::allocation', () => this._layoutLine());
        stack.add_child(this._icon);
        stack.add_child(this._dot);
        stack.add_child(this._line);
        this.add_child(stack);

        this._panel = new WlanPanel(this);
        // The whole panel scrolls on small screens; the device list also scrolls by itself.
        this._scroll = new St.ScrollView({
            style_class: 'wlan-outer-scroll', hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC, overlay_scrollbars: true, x_expand: true,
        });
        this._scroll.child = this._panel.actor;
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(this._scroll);
        this.menu.addMenuItem(item);
        // New-device alerts (trusted networks): the Omarchy widget's settings page held this.
        this._alertsItem = new PopupMenu.PopupSwitchMenuItem(t('newAlerts'), true);
        this._alertsItem.connect('toggled', (_item, on) => this.sendJson({cmd: 'alerts', on}));
        this.menu.addMenuItem(this._alertsItem);

        this.menu.connect('open-state-changed', (_menu, open) => {
            this.send(open ? 'open' : 'closed');
            if (open) {
                const workArea = Main.layoutManager.getWorkAreaForMonitor(Main.layoutManager.primaryIndex);
                const height = Math.round(workArea.height / St.ThemeContext.get_for_stage(global.stage).scale_factor);
                this._scroll.style = `max-height: ${Math.max(240, height - 110)}px;`;
                this._panel.setListHeight(Math.max(160, Math.min(420, height - 560)));
                this._panel.update(this._stats);
            } else {
                this._panel.menuClosed();
            }
        });
        // Escape in a text field, Tab in the login form and '/' for the search. In the
        // capture phase and added before the menu manager's own controller (which it
        // adds when the menu opens), so it sees the keys first (WlanPanel.handleKey).
        const keys = new Clutter.KeyController();
        keys.connect('key-press', () => {
            const [, symbol] = keys.get_key();
            return this._panel.handleKey(symbol) ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
        });
        this.menu.actor.add_action_full('wlan-monitor-keys', Clutter.EventPhase.CAPTURE, keys);
        this._render();
    }

    get gicon() {
        return this._gicon;
    }

    get scanning() {
        return this._scanBusy || this._rescanPending;
    }

    // ------------------------------------------------------------------ collector link

    onCollectorLine(data) {
        if (data.event === 'scanning') {
            this._scanBusy = true;
            this._render();
            return;
        }
        if (data.error)
            return;
        this._stats = data;
        this._scanBusy = false;
        this._rescanPending = false;
        this._render();
        if (this.menu.isOpen)
            this._panel.update(data);
    }

    onCollectorStart() {
        if (this.menu.isOpen)
            this.send('open');
    }

    onCollectorExit() {
        this._scanBusy = false;
        this._rescanPending = false;
        this._render();
    }

    send(command) {
        this._extension.collectorSend(command);
    }

    // Per-device commands; JSON.stringify keeps them on one line, the collector validates them.
    sendJson(payload) {
        this.send(JSON.stringify(payload));
    }

    rescan() {
        if (this._rescanPending)
            return;
        this._rescanPending = true;
        this.send('rescan');
        this._render();
        if (this.menu.isOpen)
            this._panel.update(this._stats);
    }

    setTrusted(trust) {
        this.send(trust ? 'trust' : 'untrust');
    }

    openWeb(url) {
        this._extension.openWeb(url);
    }

    copyText(text) {
        return this._extension.copyText(text);
    }

    openWifiSettings() {
        this._extension.openWifiSettings();
    }

    // ------------------------------------------------------------------ bar

    _render() {
        const stats = this._stats;
        const active = stats.active === true;
        const link = active ? stats.link || {} : {};
        const vpn = link.vpn || null;
        const quality = link.quality;
        this._fraction = active && quality !== null && quality !== undefined
            ? Math.max(0, Math.min(1, Number(quality) / 100)) : -1;
        this._icon.style = active ? `color: ${vpn ? COLORS.blue : COLORS.green};` : '';
        this._dot.visible = Number(stats.new_count || 0) > 0;
        this._line.visible = this._fraction >= 0;
        this._lineFill.style = this._fraction >= 0 ? `background-color: ${signalColor(this._fraction)};` : '';
        this._layoutLine();
        this._alertsItem.visible = active && link.trusted === true;
        this._alertsItem.setToggleState(stats.alerts !== false);
        this._setPulse(this.scanning);
        if (!this.scanning)
            this._icon.opacity = active ? 255 : DIM;
    }

    _layoutLine() {
        const width = this._line.has_allocation() ? this._line.allocation.get_width() : 0;
        this._lineFill.width = Math.round(width * Math.max(0.05, this._fraction));
    }

    // The icon pulses while the subnet is being scanned.
    _setPulse(on) {
        if (on === !!this._pulsing)
            return;
        this._pulsing = on;
        this._icon.remove_all_transitions();
        if (on) {
            this._icon.opacity = 255;
            this._icon.ease({
                opacity: 80, duration: 650, mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
                repeatCount: -1, autoReverse: true,
            });
        }
    }

    _onDestroy() {
        this._icon.remove_all_transitions();
        super._onDestroy();
    }
});

// ---------------------------------------------------------------------------------- extension

export default class WlanMonitorExtension extends Extension {
    enable() {
        this._indicator = new Indicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
        const script = this.dir.get_child('scripts').get_child('wlan-monitor.py').get_path();
        this._collector = new Collector(script, data => this._indicator?.onCollectorLine(data));
        this._collector.onStart = () => this._indicator?.onCollectorStart();
        this._collector.onExit = () => this._indicator?.onCollectorExit();
        this._collector.start();
    }

    disable() {
        this._collector?.stop();
        this._collector = null;
        this._indicator?.destroy();
        this._indicator = null;
    }

    collectorSend(command) {
        this._collector?.send(command);
    }

    // The collector only builds http(s) URLs for private IPv4 literals; check the shape
    // again here and hand it to the default browser, never through a shell.
    openWeb(url) {
        if (!isWebUrl(url))
            return;
        this._indicator?.menu.close();
        try {
            Gio.AppInfo.launch_default_for_uri(url, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.error(`[WLAN Monitor] could not open ${url}: ${e.message}`);
        }
    }

    copyText(text) {
        const value = String(text || '').slice(0, CLIPBOARD_LIMIT);
        if (value === '')
            return false;
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, value);
        return true;
    }

    openWifiSettings() {
        this._indicator?.menu.close();
        try {
            Gio.Subprocess.new(['gnome-control-center', 'wifi'], Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.error(`[WLAN Monitor] gnome-control-center: ${e.message}`);
        }
    }
}

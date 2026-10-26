# Test-only patch of the copied extension: screenshot the bar, then the panel's pages
# (devices, an expanded device, the network info with the FRITZ!Box form, groups, the
# network map), then disable and enable the extension (like locking the screen).
# The real scanner runs on this machine's Wi-Fi, passively: no Trust, no Rescan.
cat >> "$EXT/extension.js" <<'JS'
import Shell from 'gi://Shell';
const _origEnable = WlanMonitorExtension.prototype.enable;
WlanMonitorExtension.prototype.enable = function () {
    _origEnable.call(this);
    if (globalThis._wmTestStarted)
        return;
    globalThis._wmTestStarted = true;
    const shot = (name, then) => {
        const file = Gio.File.new_for_path(`${GLib.getenv('WM_SHOT_DIR')}/${name}.png`);
        const stream = file.replace(null, false, 0, null);
        new Shell.Screenshot().screenshot(false, stream, (s, r) => {
            s.screenshot_finish(r); stream.close(null);
            console.log(`[WLAN Monitor] screenshot ${name} written`);
            then?.();
        });
    };
    const steps = [];
    const step = (ms, fn) => steps.push([ms, fn]);
    const run = () => {
        const next = steps.shift();
        if (!next)
            return;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, next[0], () => {
            try {
                next[1]();
            } catch (e) {
                console.log(`[WLAN Monitor] TEST STEP FAILED: ${e.message}\n${e.stack}`);
            }
            run();
            return GLib.SOURCE_REMOVE;
        });
    };
    const ind = () => this._indicator;
    const panel = () => this._indicator._panel;
    step(9000, () => Main.overview.hide());
    step(9000, () => {
        const s = ind()._stats;
        console.log(`[WLAN Monitor] active ${s.active}, ssid ${s.link?.ssid}, devices ${(s.devices || []).length}, trusted ${s.link?.trusted}`);
        shot('bar');
    });
    step(500, () => ind().menu.open(false));
    step(2500, () => shot('devices'));
    step(500, () => {
        const dev = (panel()._devices || []).find(d => !d.is_gateway && !d.is_self) || panel()._devices[0];
        panel()._expandedKey = String(dev.mac || dev.ip);
        panel()._refresh();
    });
    step(1200, () => shot('device-expanded'));
    step(500, () => {
        panel()._expandedKey = '';
        panel()._toggleGroup('showinfo');
        panel()._fritzFormOpen = true;
        panel()._fritzHelpOpen = true;
        panel()._refresh();
    });
    step(1200, () => shot('info-fritz'));
    step(500, () => {
        panel()._closeFritzForm();
        panel()._fritzHelpOpen = false;
        panel()._toggleGroup('showinfo');
        panel()._setViewMode('platform');
        panel()._chooser = 'list';
        panel()._refresh();
    });
    step(1500, () => shot('groups'));
    step(500, () => {
        panel()._chooser = '';
        panel()._toggleGroup('mappage');
    });
    step(1500, () => shot('map'));
    step(500, () => {
        panel()._toggleGroup('mappage');
        panel()._setViewMode('list');
        ind().menu.close(false);
        console.log('[WLAN Monitor] SCENARIO DONE');
    });
    run();
};
JS
export EXPECT_DONE=1
export WM_SHOT_DIR="${WM_SHOT_DIR:-$ROOT/dist/screenshots}"; mkdir -p "$WM_SHOT_DIR"

# Test-only patch: the collector is replaced by tools/fixtures/mesh.json (a FRITZ!Box mesh
# with a repeater, a VPN that blocks the home network, new, pinned, hidden and renamed
# devices). Commands the panel sends are logged instead of reaching a scanner.
cp "$ROOT/tools/fixtures/mesh.json" "$T/mesh.json"
export WM_FIXTURE="$T/mesh.json"
cat >> "$EXT/extension.js" <<'JS'
import Shell from 'gi://Shell';
Collector.prototype.start = function () {
    const feed = () => {
        const [, bytes] = GLib.file_get_contents(GLib.getenv('WM_FIXTURE'));
        this._onLine(JSON.parse(new TextDecoder().decode(bytes)));
        return GLib.SOURCE_CONTINUE;
    };
    feed();
    this._feedId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, feed);
    this.onStart?.();
};
Collector.prototype.send = function (line) {
    console.log(`[WLAN Monitor] command: ${line.replace(/"password":"[^"]*"/, '"password":"***"')}`);
};
const _origStop = Collector.prototype.stop;
Collector.prototype.stop = function () {
    if (this._feedId)
        GLib.source_remove(this._feedId);
    _origStop.call(this);
};
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
    step(3000, () => {
        const dot = ind()._dot;
        const box = dot.get_allocation_box();
        console.log(`[WLAN Monitor] dot visible ${dot.visible} mapped ${dot.mapped} box ${box.x1},${box.y1} ${box.get_width()}x${box.get_height()} parent ${dot.get_parent().get_allocation_box().get_width()}`);
        shot('fx-bar');
    });
    step(500, () => ind().menu.open(false));
    step(2000, () => {
        console.log(`[WLAN Monitor] alerts switch visible ${ind()._alertsItem.visible}, search visible ${panel()._search.visible}`);
        shot('fx-devices');
    });
    step(500, () => {
        const scroll = panel()._listScroll;
        scroll.vadjustment.value = scroll.vadjustment.upper;
        panel()._showHidden = true;
        panel()._refresh();
    });
    step(1200, () => shot('fx-devices-end'));
    step(500, () => {
        panel()._showHidden = false;
        panel()._search.set_text('pho');
    });
    step(1200, () => shot('fx-search'));
    step(500, () => {
        panel()._search.set_text('');
        const ipad = panel()._devices.find(d => d.name === 'iPad');
        panel()._startRename(ipad);
    });
    step(1200, () => {
        console.log(`[WLAN Monitor] rename field focused: ${global.stage.get_key_focus() instanceof Clutter.Text}`);
        shot('fx-rename');
    });
    step(500, () => {
        const ipad = panel()._devices.find(d => d.name === 'iPad');
        panel()._finishRename(ipad, "  Anna's iPad  ");
        panel()._setViewMode('ap');
    });
    step(1200, () => shot('fx-ap'));
    step(500, () => {
        panel()._setViewMode('band');
        panel()._toggleGroup('mappage');
    });
    step(1500, () => shot('fx-map'));
    step(500, () => {
        const fritzBoxRow = panel()._mapRows.find(r => r.type === 'ap' && r.node.dev && !r.node.dev.is_gateway);
        panel()._toggleGroup(fritzBoxRow.id);
    });
    step(1200, () => shot('fx-map-folded'));
    step(500, () => ind().menu.close(false));
    run();
};
JS
export WM_SHOT_DIR="${WM_SHOT_DIR:-$ROOT/dist/screenshots}"; mkdir -p "$WM_SHOT_DIR"

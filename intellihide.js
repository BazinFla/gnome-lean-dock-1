// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import GObject from 'gi://GObject';
import {GlobalSignalsHandler} from './utils.js';

const HANDLED_WINDOW_TYPES = [
    Meta.WindowType.NORMAL,
    Meta.WindowType.DIALOG,
    Meta.WindowType.MODAL_DIALOG,
    Meta.WindowType.UTILITY,
];

export const Intellihide = GObject.registerClass({
    Signals: {
        'status-changed': {param_types: [GObject.TYPE_BOOLEAN]},
    },
}, class Intellihide extends GObject.Object {
    _init(monitorIndex) {
        super._init();
        this._monitorIndex = monitorIndex;
        this._targetBox = null;
        this._hasOverlap = false;
        this._enabled = true;
        this._checkTimeoutId = 0;
        this._trackedWindows = new Map();

        this._signals = new GlobalSignalsHandler();
        this._tracker = Shell.WindowTracker.get_default();

        this._signals.add(
            [global.display, 'window-created', (_d, win) => this._onWindowCreated(win)],
            [global.display, 'window-entered-monitor', () => this.queueCheck()],
            [global.display, 'window-left-monitor', () => this.queueCheck()],
            [global.display, 'restacked', () => this.queueCheck()],
            [global.display, 'grab-op-end', () => this.queueCheck()],
            [global.workspaceManager, 'active-workspace-changed', () => this._onWorkspaceChanged()],
            [this._tracker, 'notify::focus-app', () => this.queueCheck()]
        );

        this._trackCurrentWindows();
    }

    _trackCurrentWindows() {
        const activeWorkspace = global.workspaceManager.get_active_workspace();
        if (activeWorkspace) {
            const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, activeWorkspace);
            for (const win of windows) {
                this._onWindowCreated(win);
            }
        }
    }

    _onWorkspaceChanged() {
        this._trackCurrentWindows();
        this.queueCheck();
    }

    set enabled(val) {
        if (this._enabled === val) return;
        this._enabled = val;
        this.queueCheck();
    }

    get enabled() {
        return this._enabled;
    }

    get hasOverlap() {
        return this._hasOverlap;
    }

    setTargetBox(box) {
        this._targetBox = box;
        this.queueCheck();
    }

    _onWindowCreated(metaWindow) {
        if (!metaWindow || this._trackedWindows.has(metaWindow)) return;

        const ids = [];
        try {
            ids.push(metaWindow.connect('size-changed', () => this.queueCheck()));
            ids.push(metaWindow.connect('position-changed', () => this.queueCheck()));
            ids.push(metaWindow.connect('notify::minimized', () => this.queueCheck()));
            ids.push(metaWindow.connect('notify::maximized-horizontally', () => this.queueCheck()));
            ids.push(metaWindow.connect('notify::maximized-vertically', () => this.queueCheck()));
            ids.push(metaWindow.connect('notify::fullscreen', () => this.queueCheck()));
            ids.push(metaWindow.connect('notify::above', () => this.queueCheck()));
            ids.push(metaWindow.connect('unmanaged', () => {
                this._untrackWindow(metaWindow);
                this.queueCheck();
            }));
            this._trackedWindows.set(metaWindow, ids);
        } catch (e) {
            // Window might be invalid or already destroyed
        }

        this.queueCheck();
    }

    _untrackWindow(metaWindow) {
        const ids = this._trackedWindows.get(metaWindow);
        if (ids) {
            for (const id of ids) {
                try {
                    metaWindow.disconnect(id);
                } catch (e) {}
            }
            this._trackedWindows.delete(metaWindow);
        }
    }

    queueCheck() {
        if (this._checkTimeoutId > 0) return;
        this._checkTimeoutId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._checkTimeoutId = 0;
            this._checkOverlap();
            return GLib.SOURCE_REMOVE;
        });
    }

    _checkOverlap() {
        if (!this._enabled || !this._targetBox) {
            this._updateOverlapStatus(false);
            return;
        }

        const activeWorkspace = global.workspaceManager.get_active_workspace();
        if (!activeWorkspace) return;

        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL, activeWorkspace);
        let overlaps = false;

        const {x: tx, y: ty, width: tw, height: th} = this._targetBox;

        for (const win of windows) {
            if (!this._trackedWindows.has(win)) {
                this._onWindowCreated(win);
            }
            if (!win.showing_on_its_workspace() || win.minimized) continue;
            if (!HANDLED_WINDOW_TYPES.includes(win.get_window_type())) continue;

            if (win.get_monitor() !== this._monitorIndex) continue;

            const rect = win.get_frame_rect();
            const xOverlap = (rect.x < tx + tw) && (rect.x + rect.width > tx);
            const yOverlap = (rect.y < ty + th) && (rect.y + rect.height > ty);

            if (xOverlap && yOverlap) {
                overlaps = true;
                break;
            }
        }

        this._updateOverlapStatus(overlaps);
    }

    _updateOverlapStatus(overlaps) {
        if (this._hasOverlap !== overlaps) {
            this._hasOverlap = overlaps;
            this.emit('status-changed', this._hasOverlap);
        }
    }

    destroy() {
        if (this._checkTimeoutId > 0) {
            GLib.source_remove(this._checkTimeoutId);
            this._checkTimeoutId = 0;
        }

        for (const [metaWindow, ids] of this._trackedWindows) {
            for (const id of ids) {
                try {
                    metaWindow.disconnect(id);
                } catch (e) {}
            }
        }
        this._trackedWindows.clear();

        this._signals.destroy();
    }
});

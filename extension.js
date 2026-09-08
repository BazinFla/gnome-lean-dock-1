// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {DockManager} from './docking.js';

export let dockManager = null;

export default class GnomeLeanDockExtension extends Extension {
    enable() {
        this._dockManager = new DockManager(this);
        dockManager = this._dockManager;
    }

    disable() {
        this._dockManager?.destroy();
        this._dockManager = null;
        dockManager = null;
    }
}

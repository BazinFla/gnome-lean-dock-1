// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export const Position = Object.freeze({
    TOP: 0,
    RIGHT: 1,
    BOTTOM: 2,
    LEFT: 3,
});

/**
 * Helper class to safely track and disconnect GObject / Clutter signals.
 */
export class GlobalSignalsHandler {
    constructor() {
        this._records = [];
    }

    add(...entries) {
        for (const entry of entries) {
            if (Array.isArray(entry[0])) {
                this.add(...entry);
                continue;
            }
            const [obj, signal, callback] = entry;
            if (!obj || !signal || !callback) continue;

            let id = 0;
            try {
                if (typeof obj.connect === 'function') {
                    id = obj.connect(signal, callback);
                } else if (typeof obj.connect_after === 'function') {
                    id = obj.connect_after(signal, callback);
                }
            } catch (e) {
                console.warn(`[gld-1@bazinfla.github.com] Failed to connect signal '${signal}' on object:`, e);
            }

            if (id > 0) {
                this._records.push({ obj, id });
            }
        }
    }

    destroy() {
        for (const { obj, id } of this._records) {
            try {
                if (obj && typeof obj.disconnect === 'function') {
                    obj.disconnect(id);
                }
            } catch (e) {
                // Ignore if already destroyed
            }
        }
        this._records = [];
    }
}

/**
 * Get monitor geometry by index.
 */
export function getMonitorGeometry(monitorIndex) {
    if (monitorIndex < 0 || monitorIndex >= Main.layoutManager.monitors.length) {
        return Main.layoutManager.primaryMonitor;
    }
    return Main.layoutManager.monitors[monitorIndex];
}

/**
 * Smoothly scroll St.ScrollView so that actor is fully visible inside its viewport.
 */
export function ensureActorVisibleInScrollView(scrollView, actor) {
    if (!scrollView || !actor) return [0, 0];

    const box = actor.get_parent();
    if (!box) return [0, 0];

    const isVertical = box.vertical || false;
    const scrollViewDim = isVertical ? (scrollView.height || 0) : (scrollView.width || 0);
    const [actorMin, actorNat] = isVertical ? actor.get_preferred_height(-1) : actor.get_preferred_width(-1);
    const actorDim = actorNat || actorMin || 48;

    let actorPos = 0;
    let curr = actor;
    while (curr && curr !== box) {
        actorPos += isVertical ? curr.y : curr.x;
        curr = curr.get_parent();
    }

    const curScroll = isVertical ? (-box.translation_y || 0) : (-box.translation_x || 0);
    let targetScroll = curScroll;

    if (actorPos < curScroll) {
        targetScroll = Math.max(0, actorPos);
    } else if (actorPos + actorDim > curScroll + scrollViewDim) {
        targetScroll = Math.max(0, actorPos + actorDim - scrollViewDim);
    }

    if (Math.abs(targetScroll - curScroll) > 1) {
        box.remove_all_transitions();
        if (isVertical) {
            box.ease({
                translation_y: -targetScroll,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            box.ease({
                translation_x: -targetScroll,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    return [0, 0];
}

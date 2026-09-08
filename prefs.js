// -*- mode: js; js-indent-level: 4; indent-tabs-mode: nil -*-

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class GnomeLeanDockPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Page 1: Position & Displays
        const positionPage = new Adw.PreferencesPage({
            title: _('Position & Screens'),
            icon_name: 'preferences-desktop-display-symbolic',
        });
        window.add(positionPage);

        const posGroup = new Adw.PreferencesGroup({
            title: _('Dock Position'),
            description: _('Choose the screen edge and dimensions'),
        });
        positionPage.add(posGroup);

        // Position Row
        const posModel = new Gtk.StringList();
        posModel.append(_('Top'));
        posModel.append(_('Right'));
        posModel.append(_('Bottom'));
        posModel.append(_('Left'));

        const posRow = new Adw.ComboRow({
            title: _('Screen Edge'),
            subtitle: _('Edge of the screen where the dock will be placed'),
            model: posModel,
            selected: settings.get_enum('dock-position'),
        });
        posRow.connect('notify::selected', () => {
            settings.set_enum('dock-position', posRow.selected);
        });
        posGroup.add(posRow);

        // Extend height / panel mode
        const extendRow = new Adw.SwitchRow({
            title: _('Panel Mode (Full Length)'),
            subtitle: _('Extend the dock across the full width or height of the monitor'),
            active: settings.get_boolean('extend-height'),
        });
        settings.bind('extend-height', extendRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(extendRow);

        // Dock margin slider (Gtk.Scale)
        const marginAdjustment = new Gtk.Adjustment({
            lower: 0,
            upper: 48,
            step_increment: 1,
            page_increment: 4,
            value: settings.get_int('dock-margin'),
        });

        const marginScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: marginAdjustment,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            round_digits: 0,
            digits: 0,
        });
        marginScale.set_size_request(220, -1);
        marginScale.add_mark(0, Gtk.PositionType.BOTTOM, '0');
        marginScale.add_mark(6, Gtk.PositionType.BOTTOM, '6');
        marginScale.add_mark(12, Gtk.PositionType.BOTTOM, '12');
        marginScale.add_mark(18, Gtk.PositionType.BOTTOM, '18');
        marginScale.add_mark(24, Gtk.PositionType.BOTTOM, '24');
        marginScale.add_mark(36, Gtk.PositionType.BOTTOM, '36');
        marginScale.add_mark(48, Gtk.PositionType.BOTTOM, '48');

        marginAdjustment.connect('value-changed', () => {
            const val = Math.round(marginAdjustment.value);
            if (settings.get_int('dock-margin') !== val) {
                settings.set_int('dock-margin', val);
            }
        });
        settings.connect('changed::dock-margin', () => {
            const val = settings.get_int('dock-margin');
            if (Math.round(marginAdjustment.value) !== val) {
                marginAdjustment.value = val;
            }
        });

        const marginRow = new Adw.ActionRow({
            title: _('Dock Margin'),
            subtitle: _('Distance in pixels between the dock and screen edges (0px – 48px)'),
        });
        marginRow.add_suffix(marginScale);
        posGroup.add(marginRow);

        const updateMarginSensitivity = () => {
            marginRow.sensitive = !settings.get_boolean('extend-height');
        };
        updateMarginSensitivity();
        settings.connect('changed::extend-height', updateMarginSensitivity);

        // Multi-monitor Group
        const monitorGroup = new Adw.PreferencesGroup({
            title: _('Displays'),
        });
        positionPage.add(monitorGroup);

        const multiMonitorRow = new Adw.SwitchRow({
            title: _('Show on all displays'),
            subtitle: _('Display a dock on every connected screen'),
            active: settings.get_boolean('multi-monitor'),
        });
        settings.bind('multi-monitor', multiMonitorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        monitorGroup.add(multiMonitorRow);

        const isolateMonitorsRow = new Adw.SwitchRow({
            title: _('Isolate Displays'),
            subtitle: _('Show only applications present on the current screen'),
            active: settings.get_boolean('isolate-monitors'),
        });
        settings.bind('isolate-monitors', isolateMonitorsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        monitorGroup.add(isolateMonitorsRow);

        const isolateWorkspacesRow = new Adw.SwitchRow({
            title: _('Isolate Workspaces'),
            subtitle: _('Show only applications present on the current workspace'),
            active: settings.get_boolean('isolate-workspaces'),
        });
        settings.bind('isolate-workspaces', isolateWorkspacesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        monitorGroup.add(isolateWorkspacesRow);

        // Page 2: Behavior (Actions)
        const behaviorPage = new Adw.PreferencesPage({
            title: _('Behavior'),
            icon_name: 'preferences-desktop-gestures-symbolic',
        });
        window.add(behaviorPage);

        // Actions Group
        const actionsGroup = new Adw.PreferencesGroup({
            title: _('Mouse & Click Actions'),
            description: _('Configure interactions with dock icons and scrolling'),
        });
        behaviorPage.add(actionsGroup);

        // Click Action
        const clickActionModel = new Gtk.StringList();
        clickActionModel.append(_('Cycle Windows'));
        clickActionModel.append(_('Minimize'));
        clickActionModel.append(_('Focus'));
        clickActionModel.append(_('Show Window Previews'));

        const clickActionMap = ['CYCLE', 'MINIMIZE', 'FOCUS', 'PREVIEWS'];
        const currentClick = clickActionMap.indexOf(settings.get_string('click-action'));

        const clickRow = new Adw.ComboRow({
            title: _('Click Action'),
            subtitle: _('Action when clicking an application icon with open windows'),
            model: clickActionModel,
            selected: currentClick >= 0 ? currentClick : 0,
        });
        clickRow.connect('notify::selected', () => {
            settings.set_string('click-action', clickActionMap[clickRow.selected]);
        });
        actionsGroup.add(clickRow);

        // Middle Click Action
        const middleClickActionModel = new Gtk.StringList();
        middleClickActionModel.append(_('Close All Windows (Default)'));
        middleClickActionModel.append(_('Open New Window'));
        middleClickActionModel.append(_('Minimize All Windows'));
        middleClickActionModel.append(_('Toggle Fullscreen'));
        middleClickActionModel.append(_('Do Nothing'));

        const middleClickActionMap = ['CLOSE_ALL', 'NEW_WINDOW', 'MINIMIZE', 'TOGGLE_FULLSCREEN', 'NONE'];
        const currentMiddleClick = middleClickActionMap.indexOf(settings.get_string('middle-click-action'));

        const middleClickRow = new Adw.ComboRow({
            title: _('Middle-Click Action'),
            subtitle: _('Action when middle-clicking an application icon with open windows'),
            model: middleClickActionModel,
            selected: currentMiddleClick >= 0 ? currentMiddleClick : 0,
        });
        middleClickRow.connect('notify::selected', () => {
            settings.set_string('middle-click-action', middleClickActionMap[middleClickRow.selected]);
        });
        actionsGroup.add(middleClickRow);

        // Shift-click dedicated GPU
        const shiftGpuRow = new Adw.SwitchRow({
            title: _('Launch on Dedicated GPU (Shift + Click)'),
            subtitle: _('Launch applications on dedicated / discrete GPU when clicking while holding Shift'),
            active: settings.get_boolean('shift-click-discrete-gpu'),
        });
        settings.bind('shift-click-discrete-gpu', shiftGpuRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        actionsGroup.add(shiftGpuRow);

        // Scroll Action
        const scrollActionModel = new Gtk.StringList();
        scrollActionModel.append(_('Do Nothing'));
        scrollActionModel.append(_('Cycle Windows'));
        scrollActionModel.append(_('Switch Workspace'));

        const scrollActionMap = ['NONE', 'CYCLE', 'SWITCH-WORKSPACE'];
        const currentScroll = scrollActionMap.indexOf(settings.get_string('scroll-action'));

        const scrollRow = new Adw.ComboRow({
            title: _('Scroll Action'),
            subtitle: _('Action when scrolling the mouse wheel over the dock'),
            model: scrollActionModel,
            selected: currentScroll >= 0 ? currentScroll : 0,
        });
        scrollRow.connect('notify::selected', () => {
            settings.set_string('scroll-action', scrollActionMap[scrollRow.selected]);
        });
        actionsGroup.add(scrollRow);

        // Scroll Speed slider (Gtk.Scale)
        const scrollSpeedAdjustment = new Gtk.Adjustment({
            lower: 0.2,
            upper: 3.0,
            step_increment: 0.1,
            page_increment: 0.5,
            value: settings.get_double('scroll-speed'),
        });

        const scrollSpeedScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: scrollSpeedAdjustment,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            round_digits: 1,
            digits: 1,
        });
        scrollSpeedScale.set_size_request(220, -1);
        scrollSpeedScale.add_mark(0.5, Gtk.PositionType.BOTTOM, '0.5x');
        scrollSpeedScale.add_mark(1.0, Gtk.PositionType.BOTTOM, '1.0x');
        scrollSpeedScale.add_mark(1.5, Gtk.PositionType.BOTTOM, '1.5x');
        scrollSpeedScale.add_mark(2.0, Gtk.PositionType.BOTTOM, '2.0x');
        scrollSpeedScale.add_mark(3.0, Gtk.PositionType.BOTTOM, '3.0x');

        scrollSpeedAdjustment.connect('value-changed', () => {
            const val = Math.round(scrollSpeedAdjustment.value * 10) / 10;
            if (Math.abs(settings.get_double('scroll-speed') - val) > 0.05) {
                settings.set_double('scroll-speed', val);
            }
        });
        settings.connect('changed::scroll-speed', () => {
            const val = settings.get_double('scroll-speed');
            if (Math.abs(scrollSpeedAdjustment.value - val) > 0.05) {
                scrollSpeedAdjustment.value = val;
            }
        });

        const scrollSpeedRow = new Adw.ActionRow({
            title: _('Scroll Speed'),
            subtitle: _('Adjust scrolling sensitivity and speed (0.2x – 3.0x)'),
        });
        scrollSpeedRow.add_suffix(scrollSpeedScale);
        actionsGroup.add(scrollSpeedRow);

        // App Grid Group
        const appGridGroup = new Adw.PreferencesGroup({
            title: _('Application Grid'),
            description: _('Overview application grid and folders integration'),
        });
        behaviorPage.add(appGridGroup);

        const keepPinnedAppsRow = new Adw.SwitchRow({
            title: _('Keep Pinned Apps in AppGrid'),
            subtitle: _('Display favorite and pinned applications in the application grid and inside folders'),
            active: settings.get_boolean('keep-pinned-apps-in-grid'),
        });
        settings.bind('keep-pinned-apps-in-grid', keepPinnedAppsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        appGridGroup.add(keepPinnedAppsRow);

        // Drag & Drop Group
        const dndGroup = new Adw.PreferencesGroup({
            title: _('Drag & Drop'),
            description: _('Interactive file dragging and hover activation'),
        });
        behaviorPage.add(dndGroup);

        const springLoadRow = new Adw.SwitchRow({
            title: _('Spring-Loaded Applications'),
            subtitle: _('Bring applications to the foreground when hovering over their dock icon with a dragged file'),
            active: settings.get_boolean('enable-spring-load'),
        });
        settings.bind('enable-spring-load', springLoadRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        dndGroup.add(springLoadRow);

        // Spring load delay slider (Gtk.Scale)
        const springDelayAdjustment = new Gtk.Adjustment({
            lower: 200,
            upper: 1500,
            step_increment: 50,
            page_increment: 100,
            value: settings.get_int('spring-load-delay'),
        });

        const springDelayScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: springDelayAdjustment,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            round_digits: 0,
            digits: 0,
        });
        springDelayScale.set_size_request(220, -1);
        springDelayScale.add_mark(300, Gtk.PositionType.BOTTOM, '300ms');
        springDelayScale.add_mark(500, Gtk.PositionType.BOTTOM, '500ms');
        springDelayScale.add_mark(800, Gtk.PositionType.BOTTOM, '800ms');
        springDelayScale.add_mark(1200, Gtk.PositionType.BOTTOM, '1.2s');

        springDelayAdjustment.connect('value-changed', () => {
            const val = Math.round(springDelayAdjustment.value);
            if (settings.get_int('spring-load-delay') !== val) {
                settings.set_int('spring-load-delay', val);
            }
        });
        settings.connect('changed::spring-load-delay', () => {
            const val = settings.get_int('spring-load-delay');
            if (Math.round(springDelayAdjustment.value) !== val) {
                springDelayAdjustment.value = val;
            }
        });

        const springDelayRow = new Adw.ActionRow({
            title: _('Hover Activation Delay'),
            subtitle: _('Duration to hover over an icon before raising its window (200ms – 1500ms)'),
        });
        springDelayRow.add_suffix(springDelayScale);
        dndGroup.add(springDelayRow);

        const updateSpringSensitivity = () => {
            springDelayRow.sensitive = settings.get_boolean('enable-spring-load');
        };
        updateSpringSensitivity();
        settings.connect('changed::enable-spring-load', updateSpringSensitivity);

        // Window Previews Group
        const previewGroup = new Adw.PreferencesGroup({
            title: _('Window Previews'),
            description: _('Visual preview popups when clicking or hovering over applications with open windows'),
        });
        behaviorPage.add(previewGroup);

        const previewStyleModel = new Gtk.StringList();
        previewStyleModel.append(_('Live Visual Thumbnails (Default)'));
        previewStyleModel.append(_('Classic Text List'));

        const previewStyleMap = ['THUMBNAIL', 'LIST'];
        const currentPreviewStyle = previewStyleMap.indexOf(settings.get_string('window-preview-style'));

        const previewStyleRow = new Adw.ComboRow({
            title: _('Preview Style'),
            subtitle: _('Choose between live thumbnail cards with window controls or a compact list'),
            model: previewStyleModel,
            selected: currentPreviewStyle >= 0 ? currentPreviewStyle : 0,
        });
        previewStyleRow.connect('notify::selected', () => {
            settings.set_string('window-preview-style', previewStyleMap[previewStyleRow.selected]);
        });
        previewGroup.add(previewStyleRow);

        // Preview thumbnail size slider
        const previewSizeAdjustment = new Gtk.Adjustment({
            lower: 140,
            upper: 360,
            step_increment: 10,
            page_increment: 40,
            value: settings.get_int('window-preview-size'),
        });

        const previewSizeScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: previewSizeAdjustment,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            round_digits: 0,
            digits: 0,
        });
        previewSizeScale.set_size_request(220, -1);
        previewSizeScale.add_mark(160, Gtk.PositionType.BOTTOM, '160px');
        previewSizeScale.add_mark(220, Gtk.PositionType.BOTTOM, '220px');
        previewSizeScale.add_mark(280, Gtk.PositionType.BOTTOM, '280px');
        previewSizeScale.add_mark(340, Gtk.PositionType.BOTTOM, '340px');

        previewSizeAdjustment.connect('value-changed', () => {
            const val = Math.round(previewSizeAdjustment.value);
            if (settings.get_int('window-preview-size') !== val) {
                settings.set_int('window-preview-size', val);
            }
        });
        settings.connect('changed::window-preview-size', () => {
            const val = settings.get_int('window-preview-size');
            if (Math.round(previewSizeAdjustment.value) !== val) {
                previewSizeAdjustment.value = val;
            }
        });

        const previewSizeRow = new Adw.ActionRow({
            title: _('Thumbnail Width'),
            subtitle: _('Size in pixels of window preview thumbnails (140px – 360px)'),
        });
        previewSizeRow.add_suffix(previewSizeScale);
        previewGroup.add(previewSizeRow);

        const updatePreviewSizeSensitivity = () => {
            previewSizeRow.sensitive = settings.get_string('window-preview-style') === 'THUMBNAIL';
        };
        updatePreviewSizeSensitivity();
        settings.connect('changed::window-preview-style', updatePreviewSizeSensitivity);

        // Page 3: Appearance
        const appearancePage = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'applications-graphics-symbolic',
        });
        window.add(appearancePage);

        const iconGroup = new Adw.PreferencesGroup({
            title: _('Icons & Buttons'),
        });
        appearancePage.add(iconGroup);

        // Icon size slider (Gtk.Scale)
        const iconSizeAdjustment = new Gtk.Adjustment({
            lower: 16,
            upper: 128,
            step_increment: 2,
            page_increment: 8,
            value: settings.get_int('dash-max-icon-size'),
        });

        const iconSizeScale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            adjustment: iconSizeAdjustment,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            hexpand: true,
            round_digits: 0,
            digits: 0,
        });
        iconSizeScale.set_size_request(220, -1);
        iconSizeScale.add_mark(16, Gtk.PositionType.BOTTOM, '16');
        iconSizeScale.add_mark(32, Gtk.PositionType.BOTTOM, '32');
        iconSizeScale.add_mark(48, Gtk.PositionType.BOTTOM, '48');
        iconSizeScale.add_mark(64, Gtk.PositionType.BOTTOM, '64');
        iconSizeScale.add_mark(96, Gtk.PositionType.BOTTOM, '96');
        iconSizeScale.add_mark(128, Gtk.PositionType.BOTTOM, '128');

        iconSizeAdjustment.connect('value-changed', () => {
            const val = Math.round(iconSizeAdjustment.value);
            if (settings.get_int('dash-max-icon-size') !== val) {
                settings.set_int('dash-max-icon-size', val);
            }
        });
        settings.connect('changed::dash-max-icon-size', () => {
            const val = settings.get_int('dash-max-icon-size');
            if (Math.round(iconSizeAdjustment.value) !== val) {
                iconSizeAdjustment.value = val;
            }
        });

        const iconSizeRow = new Adw.ActionRow({
            title: _('Icon Size'),
            subtitle: _('Size in pixels for application and dock icons (16px – 128px)'),
        });
        iconSizeRow.add_suffix(iconSizeScale);
        iconGroup.add(iconSizeRow);

        // Show application names on hover
        const showAppNamesRow = new Adw.SwitchRow({
            title: _('Show Application Names on Hover'),
            subtitle: _('Display tooltips with application names when hovering over dock icons'),
            active: settings.get_boolean('show-app-names'),
        });
        settings.bind('show-app-names', showAppNamesRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        iconGroup.add(showAppNamesRow);

        // Show apps button at top/start
        const showAppsAtTopRow = new Adw.SwitchRow({
            title: _('Show Applications at Start'),
            subtitle: _('Place the "Show Applications" icon at the beginning of the dock'),
            active: settings.get_boolean('show-apps-at-top'),
        });
        settings.bind('show-apps-at-top', showAppsAtTopRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        iconGroup.add(showAppsAtTopRow);

        // Show/hide apps button
        const showAppsButtonRow = new Adw.SwitchRow({
            title: _('Show Applications Icon'),
            subtitle: _('Display the button to open the full applications grid'),
            active: settings.get_boolean('show-show-apps-button'),
        });
        settings.bind('show-show-apps-button', showAppsButtonRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        iconGroup.add(showAppsButtonRow);

        // Running Indicators Group
        const indicatorGroup = new Adw.PreferencesGroup({
            title: _('Running Indicators'),
            description: _('Visual indicators for running applications and window counts'),
        });
        appearancePage.add(indicatorGroup);

        // Indicator Style Row
        const indicatorStyleModel = new Gtk.StringList();
        indicatorStyleModel.append(_('Multi-Dots by Window Count (1, 2, 3+)'));
        indicatorStyleModel.append(_('Continuous Line / Pill'));
        indicatorStyleModel.append(_('Compact Dash'));
        indicatorStyleModel.append(_('Ambient Glow'));

        const indicatorStyleMap = ['DOTS', 'LINE', 'DASH', 'GLOW'];
        const currentIndicatorStyle = indicatorStyleMap.indexOf(settings.get_string('running-indicator-style'));

        const indicatorStyleRow = new Adw.ComboRow({
            title: _('Indicator Style'),
            subtitle: _('Visual appearance of the active running indicator'),
            model: indicatorStyleModel,
            selected: currentIndicatorStyle >= 0 ? currentIndicatorStyle : 0,
        });
        indicatorStyleRow.connect('notify::selected', () => {
            settings.set_string('running-indicator-style', indicatorStyleMap[indicatorStyleRow.selected]);
        });
        indicatorGroup.add(indicatorStyleRow);

        // Indicator Color Row
        const indicatorColorModel = new Gtk.StringList();
        indicatorColorModel.append(_('System Accent Color (Auto)'));
        indicatorColorModel.append(_('Blue (Adwaita)'));
        indicatorColorModel.append(_('Teal'));
        indicatorColorModel.append(_('Green'));
        indicatorColorModel.append(_('Yellow'));
        indicatorColorModel.append(_('Orange'));
        indicatorColorModel.append(_('Red'));
        indicatorColorModel.append(_('Pink'));
        indicatorColorModel.append(_('Purple'));
        indicatorColorModel.append(_('Slate'));
        indicatorColorModel.append(_('White'));

        const indicatorColorMap = ['SYSTEM', 'BLUE', 'TEAL', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE', 'SLATE', 'WHITE'];
        const currentIndicatorColor = indicatorColorMap.indexOf(settings.get_string('running-indicator-color'));

        const indicatorColorRow = new Adw.ComboRow({
            title: _('Indicator Color Theme'),
            subtitle: _('Color scheme used for running dots and underlines'),
            model: indicatorColorModel,
            selected: currentIndicatorColor >= 0 ? currentIndicatorColor : 0,
        });
        indicatorColorRow.connect('notify::selected', () => {
            settings.set_string('running-indicator-color', indicatorColorMap[indicatorColorRow.selected]);
        });
        indicatorGroup.add(indicatorColorRow);

        // Opacity group
        const styleGroup = new Adw.PreferencesGroup({
            title: _('Background & Opacity'),
        });
        appearancePage.add(styleGroup);

        const opacityAdjustment = new Gtk.Adjustment({
            lower: 0.0,
            upper: 1.0,
            step_increment: 0.05,
            page_increment: 0.1,
            value: settings.get_double('background-opacity'),
        });
        const opacityRow = new Adw.SpinRow({
            title: _('Background Opacity'),
            subtitle: _('Opacity level of the dock container (0.0 to 1.0)'),
            adjustment: opacityAdjustment,
            digits: 2,
        });
        settings.bind('background-opacity', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        styleGroup.add(opacityRow);
    }
}

"use strict";

function dice_initialize(container) {
    $t.remove($t.id('loading_text'));

    var canvas = $t.id('canvas');
    canvas.style.width = window.innerWidth - 1 + 'px';
    canvas.style.height = window.innerHeight - 1 + 'px';

    var label = $t.id('label');
    var set = $t.id('set');
    var selector_div = $t.id('selector_div');
    var info_div = $t.id('info_div');
    on_set_change();

    $t.dice.use_true_random = false;

    function on_set_change(ev) { set.style.width = set.value.length + 3 + 'ex'; }
    $t.bind(set, 'keyup', on_set_change);
    $t.bind(set, 'mousedown', function(ev) { ev.stopPropagation(); });
    $t.bind(set, 'mouseup', function(ev) { ev.stopPropagation(); });
    $t.bind(set, 'focus', function(ev) { $t.set(container, { class: '' }); });
    $t.bind(set, 'blur', function(ev) { $t.set(container, { class: 'noselect' }); });

    $t.bind($t.id('clear'), ['mouseup', 'touchend'], function(ev) {
        ev.stopPropagation();
        set.value = '0';
        on_set_change();
    });

    var params = $t.get_url_params();

    $t.dice.desk_color = 0x00ff00;
    info_div.style.display = 'none';
    $t.dice.dice_color = '#44475a';
    $t.dice.label_color = '#ffb86c';
    params.shadows = 0;

    if (params.scale) {
	$t.dice.scalemod = params.scale
    }

    if (params.chromakey) {
        $t.dice.desk_color = 0x00ff00;
        info_div.style.display = 'none';
        $t.id('control_panel').style.display = 'none';
    }
    if (params.shadows == 0) {
        $t.dice.use_shadows = false;
    }
    if (params.color == 'white') {
        $t.dice.dice_color = '#808080';
        $t.dice.label_color = '#202020';
    }
    if (params.dicecolor) {
        $t.dice.dice_color = params.dicecolor;
    }
    if (params.labelcolor) {
        $t.dice.label_color = params.labelcolor;
    }
    if (params.dicehex) {
        $t.dice.dice_color = '#' + params.dicehex;
    }
    if (params.labelhex) {
        $t.dice.label_color = '#' + params.labelhex;
    }
    if (params.dicecolorhex) {
        $t.dice.dice_color = '#' + params.dicecolorhex;
    }
    if (params.labelcolorhex) {
        $t.dice.label_color = '#' + params.labelcolorhex;
    }
    if (params.chromahex) {
        $t.dice.desk_color = '#' + params.chromahex;
        $t.dice.selector_back_colors = { color: '#' + params.chromahex, shininess: 0, emissive: '#' + params.chromahex };
    }

    if (params.transparency){
        $t.dice.material_options = {
            specular: 0x172022,
            color: 0xf0f0f0,
            shininess: 10,
            shading: THREE.FlatShading,
            transparent: true,
            opacity: params.transparency,
            //side: THREE.DoubleSide,
        };

    }

    if (!params.w) {
        params.w = 500;
    }
    if (!params.h) {
        params.h = 300;
    }
	
    if (params.dicevalue) {
        $t.dice.dice_value = params.dicevalue;
    }





    var box = new $t.dice.dice_box(canvas, { w: params.w, h: params.h });
    box.animate_selector = false;

    $t.bind(window, 'resize', function() {
        canvas.style.width = window.innerWidth - 1 + 'px';
        canvas.style.height = window.innerHeight - 1 + 'px';
        // box.reinit(canvas, { w: 500, h: 300 });
    });

    function show_selector() {
        info_div.style.display = 'none';
        selector_div.style.display = 'inline-block';
        box.draw_selector();
    }

    function before_roll(vectors, notation, callback) {
        info_div.style.display = 'none';
        selector_div.style.display = 'none';
        // do here rpc call or whatever to get your own result of throw.
        // then callback with array of your result, example:
        // callback([2, 2, 2, 2]); // for 4d6 where all dice values are 2.
        callback();
    }

    function notation_getter() {
        return $t.dice.parse_notation(set.value);
    }

    function after_roll(notation, result) {
        if (params.chromakey || params.noresult) return;
        var res = result.join(' ');
        if (notation.constant) {
            if (notation.constant > 0) res += ' +' + notation.constant;
            else res += ' -' + Math.abs(notation.constant);
        }
        if (result.length > 1) res += ' = ' + 
                (result.reduce(function(s, a) { return s + a; }) + notation.constant);
        label.innerHTML = res;
        info_div.style.display = 'inline-block';
    }

    box.bind_mouse(container, notation_getter, before_roll, after_roll);
    box.bind_throw($t.id('throw'), notation_getter, before_roll, after_roll);

    $t.bind(container, ['mouseup', 'touchend'], function(ev) {
        ev.stopPropagation();
        if (selector_div.style.display == 'none') {
            if (!box.rolling) show_selector();
            box.rolling = false;
            return;
        }
        var name = box.search_dice_by_mouse(ev);
        if (name != undefined) {
            var notation = $t.dice.parse_notation(set.value);
            notation.set.push(name);
            set.value = $t.dice.stringify_notation(notation);
            on_set_change();
        }
    });

    if (params.notation) {
        set.value = params.notation;
    } else if (params.d) {
        set.value = params.d;
    }
    if (params.roll) {
        $t.raise_event($t.id('throw'), 'mouseup');
    }
    else {
        show_selector();
    }
}

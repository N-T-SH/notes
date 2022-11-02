'use strict';

var obsidian = require('obsidian');

const VIEW_TYPE = "cross-reference-navigation";

function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}
function subscribe(store, ...callbacks) {
    if (store == null) {
        return noop;
    }
    const unsub = store.subscribe(...callbacks);
    return unsub.unsubscribe ? () => unsub.unsubscribe() : unsub;
}
function get_store_value(store) {
    let value;
    subscribe(store, _ => value = _)();
    return value;
}
function null_to_empty(value) {
    return value == null ? '' : value;
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function destroy_each(iterations, detaching) {
    for (let i = 0; i < iterations.length; i += 1) {
        if (iterations[i])
            iterations[i].d(detaching);
    }
}
function element(name) {
    return document.createElement(name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function empty() {
    return text('');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_data(text, data) {
    data = '' + data;
    if (text.wholeText !== data)
        text.data = data;
}
function set_style(node, key, value, important) {
    node.style.setProperty(key, value, important ? 'important' : '');
}
// unfortunately this can't be a constant as that wouldn't be tree-shakeable
// so we cache the result instead
let crossorigin;
function is_crossorigin() {
    if (crossorigin === undefined) {
        crossorigin = false;
        try {
            if (typeof window !== 'undefined' && window.parent) {
                void window.parent.document;
            }
        }
        catch (error) {
            crossorigin = true;
        }
    }
    return crossorigin;
}
function add_resize_listener(node, fn) {
    const computed_style = getComputedStyle(node);
    if (computed_style.position === 'static') {
        node.style.position = 'relative';
    }
    const iframe = element('iframe');
    iframe.setAttribute('style', 'display: block; position: absolute; top: 0; left: 0; width: 100%; height: 100%; ' +
        'overflow: hidden; border: 0; opacity: 0; pointer-events: none; z-index: -1;');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    const crossorigin = is_crossorigin();
    let unsubscribe;
    if (crossorigin) {
        iframe.src = "data:text/html,<script>onresize=function(){parent.postMessage(0,'*')}</script>";
        unsubscribe = listen(window, 'message', (event) => {
            if (event.source === iframe.contentWindow)
                fn();
        });
    }
    else {
        iframe.src = 'about:blank';
        iframe.onload = () => {
            unsubscribe = listen(iframe.contentWindow, 'resize', fn);
        };
    }
    append(node, iframe);
    return () => {
        if (crossorigin) {
            unsubscribe();
        }
        else if (unsubscribe && iframe.contentWindow) {
            unsubscribe();
        }
        detach(iframe);
    };
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error('Function called outside component initialization');
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
let flushing = false;
const seen_callbacks = new Set();
function flush() {
    if (flushing)
        return;
    flushing = true;
    do {
        // first, call beforeUpdate functions
        // and update components
        for (let i = 0; i < dirty_components.length; i += 1) {
            const component = dirty_components[i];
            set_current_component(component);
            update(component.$$);
        }
        set_current_component(null);
        dirty_components.length = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    flushing = false;
    seen_callbacks.clear();
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
let outros;
function group_outros() {
    outros = {
        r: 0,
        c: [],
        p: outros // parent group
    };
}
function check_outros() {
    if (!outros.r) {
        run_all(outros.c);
    }
    outros = outros.p;
}
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function transition_out(block, local, detach, callback) {
    if (block && block.o) {
        if (outroing.has(block))
            return;
        outroing.add(block);
        outros.c.push(() => {
            outroing.delete(block);
            if (callback) {
                if (detach)
                    block.d(1);
                callback();
            }
        });
        block.o(local);
    }
}
function create_component(block) {
    block && block.c();
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(parent_component ? parent_component.$$.context : []),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

function tagParts(tag) {
    let temp = tag.slice();
    if (tag.startsWith("#")) {
        temp = temp.slice(1);
    }
    if (temp.contains('/')) {
        let split = temp.split('/');
        let label = split.shift();
        let title = split.join('/');
        return {
            tag: tag,
            label: label,
            title: title
        };
    }
    else {
        return {
            tag: tag,
            title: temp
        };
    }
}

/* src/ui/TagTitle.svelte generated by Svelte v3.35.0 */

function add_css$1() {
	var style = element("style");
	style.id = "svelte-thzrmn-style";
	style.textContent = "p.svelte-thzrmn{margin:0}.strong.svelte-thzrmn{font-weight:bold}.small.svelte-thzrmn{font-size:12px;line-height:14px}.muted.svelte-thzrmn{opacity:0.5}";
	append(document.head, style);
}

// (29:0) {:else}
function create_else_block$1(ctx) {
	let p;
	let span;
	let t0_value = (/*label*/ ctx[2] ? /*label*/ ctx[2] + "/" : "") + "";
	let t0;
	let t1;
	let p_class_value;

	return {
		c() {
			p = element("p");
			span = element("span");
			t0 = text(t0_value);
			t1 = text(/*title*/ ctx[3]);
			attr(span, "class", "muted svelte-thzrmn");
			attr(p, "class", p_class_value = "" + (null_to_empty(/*strong*/ ctx[1] ? "strong" : "") + " svelte-thzrmn"));
		},
		m(target, anchor) {
			insert(target, p, anchor);
			append(p, span);
			append(span, t0);
			append(p, t1);
		},
		p(ctx, dirty) {
			if (dirty & /*label*/ 4 && t0_value !== (t0_value = (/*label*/ ctx[2] ? /*label*/ ctx[2] + "/" : "") + "")) set_data(t0, t0_value);
			if (dirty & /*title*/ 8) set_data(t1, /*title*/ ctx[3]);

			if (dirty & /*strong*/ 2 && p_class_value !== (p_class_value = "" + (null_to_empty(/*strong*/ ctx[1] ? "strong" : "") + " svelte-thzrmn"))) {
				attr(p, "class", p_class_value);
			}
		},
		d(detaching) {
			if (detaching) detach(p);
		}
	};
}

// (24:0) {#if !inline}
function create_if_block$1(ctx) {
	let div;
	let p0;
	let t0_value = (/*label*/ ctx[2] ? /*label*/ ctx[2] + "/" : "") + "";
	let t0;
	let t1;
	let p1;
	let t2;
	let div_class_value;

	return {
		c() {
			div = element("div");
			p0 = element("p");
			t0 = text(t0_value);
			t1 = space();
			p1 = element("p");
			t2 = text(/*title*/ ctx[3]);
			attr(p0, "class", "small muted svelte-thzrmn");
			attr(p1, "class", "svelte-thzrmn");
			attr(div, "class", div_class_value = "" + (null_to_empty(/*strong*/ ctx[1] ? "strong" : "") + " svelte-thzrmn"));
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, p0);
			append(p0, t0);
			append(div, t1);
			append(div, p1);
			append(p1, t2);
		},
		p(ctx, dirty) {
			if (dirty & /*label*/ 4 && t0_value !== (t0_value = (/*label*/ ctx[2] ? /*label*/ ctx[2] + "/" : "") + "")) set_data(t0, t0_value);
			if (dirty & /*title*/ 8) set_data(t2, /*title*/ ctx[3]);

			if (dirty & /*strong*/ 2 && div_class_value !== (div_class_value = "" + (null_to_empty(/*strong*/ ctx[1] ? "strong" : "") + " svelte-thzrmn"))) {
				attr(div, "class", div_class_value);
			}
		},
		d(detaching) {
			if (detaching) detach(div);
		}
	};
}

function create_fragment$1(ctx) {
	let if_block_anchor;

	function select_block_type(ctx, dirty) {
		if (!/*inline*/ ctx[0]) return create_if_block$1;
		return create_else_block$1;
	}

	let current_block_type = select_block_type(ctx);
	let if_block = current_block_type(ctx);

	return {
		c() {
			if_block.c();
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if_block.m(target, anchor);
			insert(target, if_block_anchor, anchor);
		},
		p(ctx, [dirty]) {
			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
				if_block.p(ctx, dirty);
			} else {
				if_block.d(1);
				if_block = current_block_type(ctx);

				if (if_block) {
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let { tag } = $$props;
	let { inline = false } = $$props;
	let { strong = false } = $$props;
	let label;
	let title;

	function recalc(tag) {
		let temp = tag.slice();

		if (tag.startsWith("#")) {
			temp = temp.slice(1);
		}

		if (temp.contains("/")) {
			let split = temp.split("/");
			$$invalidate(2, label = split.shift());
			$$invalidate(3, title = split.join("/"));
		} else {
			$$invalidate(2, label = undefined);
			$$invalidate(3, title = temp);
		}
	}

	$$self.$$set = $$props => {
		if ("tag" in $$props) $$invalidate(4, tag = $$props.tag);
		if ("inline" in $$props) $$invalidate(0, inline = $$props.inline);
		if ("strong" in $$props) $$invalidate(1, strong = $$props.strong);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*tag*/ 16) {
			recalc(tag);
		}
	};

	return [inline, strong, label, title, tag];
}

class TagTitle extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-thzrmn-style")) add_css$1();
		init(this, options, instance$1, create_fragment$1, safe_not_equal, { tag: 4, inline: 0, strong: 1 });
	}
}

/* src/ui/TagMenu.svelte generated by Svelte v3.35.0 */

function add_css() {
	var style = element("style");
	style.id = "svelte-1t8t6cm-style";
	style.textContent = "p.svelte-1t8t6cm.svelte-1t8t6cm{margin:0}.path.svelte-1t8t6cm.svelte-1t8t6cm{display:flex;align-items:flex-end}.path.svelte-1t8t6cm>.svelte-1t8t6cm{margin:0 5px}.muted.svelte-1t8t6cm.svelte-1t8t6cm{opacity:0.5}.strong.svelte-1t8t6cm.svelte-1t8t6cm{font-weight:bold}.small.svelte-1t8t6cm.svelte-1t8t6cm{font-size:12px}.flex.svelte-1t8t6cm.svelte-1t8t6cm{display:flex;justify-content:flex-start}.align-bottom.svelte-1t8t6cm.svelte-1t8t6cm{align-items:flex-end}.align-center.svelte-1t8t6cm.svelte-1t8t6cm{align-items:center}.flex-wrap.svelte-1t8t6cm.svelte-1t8t6cm{flex-wrap:wrap}.spacer.svelte-1t8t6cm.svelte-1t8t6cm{width:10px;height:10px}.flex-spacer.svelte-1t8t6cm.svelte-1t8t6cm{flex-grow:1;flex-shrink:0;width:5px}.mutedLink.svelte-1t8t6cm.svelte-1t8t6cm{cursor:pointer;opacity:0.5;transition:all 0.2 ease}.mutedLink.svelte-1t8t6cm.svelte-1t8t6cm:hover{opacity:1}.link.svelte-1t8t6cm.svelte-1t8t6cm{cursor:pointer;background:transparent;border-radius:3px;transition:all 0.25s ease;font-size:14px}.link.svelte-1t8t6cm.svelte-1t8t6cm:hover{background:var(--interactive-accent);color:var(--text-on-accent);padding-left:4px}.small.svelte-1t8t6cm.svelte-1t8t6cm{font-size:13px}ul.svelte-1t8t6cm.svelte-1t8t6cm{list-style:none;padding-left:0;margin:0}li.intersection.svelte-1t8t6cm.svelte-1t8t6cm:before{content:\"+\";margin-right:4px;opacity:0.5}li.note.svelte-1t8t6cm.svelte-1t8t6cm:before{content:\"→\";margin-right:4px}.cutoff.svelte-1t8t6cm.svelte-1t8t6cm{max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.btn.svelte-1t8t6cm.svelte-1t8t6cm{cursor:pointer;padding:4px 10px;border-radius:100px;border:1px solid var(--interactive-accent);font-weight:bold;font-size:12px;margin-right:10px;transition:all 0.2s ease}.btn.svelte-1t8t6cm.svelte-1t8t6cm:hover,.btn.selected.svelte-1t8t6cm.svelte-1t8t6cm{background:var(--interactive-accent);color:var(--text-on-accent)}";
	append(document.head, style);
}

function get_each_context(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[29] = list[i];
	return child_ctx;
}

function get_each_context_1(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[32] = list[i];
	return child_ctx;
}

function get_each_context_2(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[35] = list[i];
	return child_ctx;
}

function get_each_context_3(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[29] = list[i];
	return child_ctx;
}

function get_each_context_4(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[40] = list[i];
	return child_ctx;
}

function get_each_context_5(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[32] = list[i];
	return child_ctx;
}

function get_each_context_6(ctx, list, i) {
	const child_ctx = ctx.slice();
	child_ctx[35] = list[i];
	child_ctx[46] = i;
	return child_ctx;
}

// (170:6) {#each selectedTags as tag, index}
function create_each_block_6(ctx) {
	let div0;
	let t1;
	let div1;
	let tagtitle;
	let current;
	let mounted;
	let dispose;
	tagtitle = new TagTitle({ props: { tag: /*tag*/ ctx[35] } });

	function click_handler_1(...args) {
		return /*click_handler_1*/ ctx[18](/*tag*/ ctx[35], /*index*/ ctx[46], ...args);
	}

	return {
		c() {
			div0 = element("div");
			div0.textContent = "›";
			t1 = space();
			div1 = element("div");
			create_component(tagtitle.$$.fragment);
			attr(div0, "class", "svelte-1t8t6cm");
			attr(div1, "class", "link svelte-1t8t6cm");
		},
		m(target, anchor) {
			insert(target, div0, anchor);
			insert(target, t1, anchor);
			insert(target, div1, anchor);
			mount_component(tagtitle, div1, null);
			current = true;

			if (!mounted) {
				dispose = listen(div1, "click", click_handler_1);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			const tagtitle_changes = {};
			if (dirty[0] & /*selectedTags*/ 4) tagtitle_changes.tag = /*tag*/ ctx[35];
			tagtitle.$set(tagtitle_changes);
		},
		i(local) {
			if (current) return;
			transition_in(tagtitle.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(tagtitle.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div0);
			if (detaching) detach(t1);
			if (detaching) detach(div1);
			destroy_component(tagtitle);
			mounted = false;
			dispose();
		}
	};
}

// (187:8) {#if label.length > 0}
function create_if_block_6(ctx) {
	let div;
	let t_value = /*label*/ ctx[32] + "";
	let t;
	let div_class_value;
	let mounted;
	let dispose;

	function click_handler_2(...args) {
		return /*click_handler_2*/ ctx[19](/*label*/ ctx[32], ...args);
	}

	return {
		c() {
			div = element("div");
			t = text(t_value);

			attr(div, "class", div_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[4].favoriteGroups.includes(/*label*/ ctx[32])
			? "btn selected"
			: "btn") + " svelte-1t8t6cm"));
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, t);

			if (!mounted) {
				dispose = listen(div, "click", click_handler_2);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*groupsSorted*/ 64 && t_value !== (t_value = /*label*/ ctx[32] + "")) set_data(t, t_value);

			if (dirty[0] & /*$settingsStore, groupsSorted*/ 80 && div_class_value !== (div_class_value = "" + (null_to_empty(/*$settingsStore*/ ctx[4].favoriteGroups.includes(/*label*/ ctx[32])
			? "btn selected"
			: "btn") + " svelte-1t8t6cm"))) {
				attr(div, "class", div_class_value);
			}
		},
		d(detaching) {
			if (detaching) detach(div);
			mounted = false;
			dispose();
		}
	};
}

// (186:6) {#each groupsSorted as label}
function create_each_block_5(ctx) {
	let if_block_anchor;
	let if_block = /*label*/ ctx[32].length > 0 && create_if_block_6(ctx);

	return {
		c() {
			if (if_block) if_block.c();
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (/*label*/ ctx[32].length > 0) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block_6(ctx);
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		d(detaching) {
			if (if_block) if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

// (192:6) {#if groupsSorted.length < 1 || (groupsSorted.length == 0 && groupsSorted[0] == "")}
function create_if_block_5(ctx) {
	let div;

	return {
		c() {
			div = element("div");
			div.textContent = "No tag groups available to favorite. By using a tag such as \"#group/tag\", you'll be able to favorite certain groups here.";
			attr(div, "class", "muted svelte-1t8t6cm");
		},
		m(target, anchor) {
			insert(target, div, anchor);
		},
		d(detaching) {
			if (detaching) detach(div);
		}
	};
}

// (199:4) {#if totalCount > 3}
function create_if_block_1(ctx) {
	let each_1_anchor;
	let current;
	let each_value_1 = /*groupsSorted*/ ctx[6];
	let each_blocks = [];

	for (let i = 0; i < each_value_1.length; i += 1) {
		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			each_1_anchor = empty();
		},
		m(target, anchor) {
			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(target, anchor);
			}

			insert(target, each_1_anchor, anchor);
			current = true;
		},
		p(ctx, dirty) {
			if (dirty[0] & /*toggleExpandedGroup, groupsSorted, tagsSorted, columns, expandedGroups, toShow, openFile, sortCrossrefs, selectTags, selectedTags*/ 95468) {
				each_value_1 = /*groupsSorted*/ ctx[6];
				let i;

				for (i = 0; i < each_value_1.length; i += 1) {
					const child_ctx = get_each_context_1(ctx, each_value_1, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block_1(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(each_1_anchor.parentNode, each_1_anchor);
					}
				}

				group_outros();

				for (i = each_value_1.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_1.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			destroy_each(each_blocks, detaching);
			if (detaching) detach(each_1_anchor);
		}
	};
}

// (210:14) {#if toShow[label][tag].files.length > 5}
function create_if_block_4(ctx) {
	let ul;
	let t;
	let div;
	let current;
	let each_value_4 = /*sortCrossrefs*/ ctx[13](/*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].crossrefs).slice(0, 5);
	let each_blocks = [];

	for (let i = 0; i < each_value_4.length; i += 1) {
		each_blocks[i] = create_each_block_4(get_each_context_4(ctx, each_value_4, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	return {
		c() {
			ul = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t = space();
			div = element("div");
			attr(ul, "class", "svelte-1t8t6cm");
			attr(div, "class", "spacer svelte-1t8t6cm");
		},
		m(target, anchor) {
			insert(target, ul, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(ul, null);
			}

			insert(target, t, anchor);
			insert(target, div, anchor);
			current = true;
		},
		p(ctx, dirty) {
			if (dirty[0] & /*selectTags, selectedTags, tagsSorted, groupsSorted, expandedGroups, columns, sortCrossrefs, toShow*/ 13548) {
				each_value_4 = /*sortCrossrefs*/ ctx[13](/*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].crossrefs).slice(0, 5);
				let i;

				for (i = 0; i < each_value_4.length; i += 1) {
					const child_ctx = get_each_context_4(ctx, each_value_4, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block_4(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(ul, null);
					}
				}

				group_outros();

				for (i = each_value_4.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_4.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(ul);
			destroy_each(each_blocks, detaching);
			if (detaching) detach(t);
			if (detaching) detach(div);
		}
	};
}

// (212:18) {#each sortCrossrefs(toShow[label][tag].crossrefs).slice(0, 5) as tag2}
function create_each_block_4(ctx) {
	let li;
	let div0;
	let tagtitle;
	let t0;
	let div1;
	let t1;
	let span;
	let t2_value = /*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].crossrefs[/*tag2*/ ctx[40]] + "";
	let t2;
	let t3;
	let current;
	let mounted;
	let dispose;

	tagtitle = new TagTitle({
			props: { tag: /*tag2*/ ctx[40], inline: true }
		});

	function click_handler_4(...args) {
		return /*click_handler_4*/ ctx[21](/*tag*/ ctx[35], /*tag2*/ ctx[40], ...args);
	}

	return {
		c() {
			li = element("li");
			div0 = element("div");
			create_component(tagtitle.$$.fragment);
			t0 = space();
			div1 = element("div");
			t1 = space();
			span = element("span");
			t2 = text(t2_value);
			t3 = space();
			attr(div0, "class", "flex small svelte-1t8t6cm");
			attr(div1, "class", "flex-spacer svelte-1t8t6cm");
			attr(span, "class", "muted svelte-1t8t6cm");
			attr(li, "class", "intersection flex link svelte-1t8t6cm");
		},
		m(target, anchor) {
			insert(target, li, anchor);
			append(li, div0);
			mount_component(tagtitle, div0, null);
			append(li, t0);
			append(li, div1);
			append(li, t1);
			append(li, span);
			append(span, t2);
			append(li, t3);
			current = true;

			if (!mounted) {
				dispose = listen(li, "click", click_handler_4);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			const tagtitle_changes = {};
			if (dirty[0] & /*toShow, groupsSorted, tagsSorted, expandedGroups, columns*/ 1256) tagtitle_changes.tag = /*tag2*/ ctx[40];
			tagtitle.$set(tagtitle_changes);
			if ((!current || dirty[0] & /*toShow, groupsSorted, tagsSorted, expandedGroups, columns*/ 1256) && t2_value !== (t2_value = /*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].crossrefs[/*tag2*/ ctx[40]] + "")) set_data(t2, t2_value);
		},
		i(local) {
			if (current) return;
			transition_in(tagtitle.$$.fragment, local);
			current = true;
		},
		o(local) {
			transition_out(tagtitle.$$.fragment, local);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(li);
			destroy_component(tagtitle);
			mounted = false;
			dispose();
		}
	};
}

// (225:16) {#each toShow[label][tag].files.slice(0, 5) as file}
function create_each_block_3(ctx) {
	let li;
	let t_value = /*file*/ ctx[29].basename + "";
	let t;
	let mounted;
	let dispose;

	function click_handler_5(...args) {
		return /*click_handler_5*/ ctx[22](/*file*/ ctx[29], ...args);
	}

	return {
		c() {
			li = element("li");
			t = text(t_value);
			attr(li, "class", "small note cutoff link svelte-1t8t6cm");
			attr(li, "style", "max-width:" + columnWidth + "px");
		},
		m(target, anchor) {
			insert(target, li, anchor);
			append(li, t);

			if (!mounted) {
				dispose = listen(li, "click", click_handler_5);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*toShow, groupsSorted, tagsSorted, expandedGroups, columns*/ 1256 && t_value !== (t_value = /*file*/ ctx[29].basename + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(li);
			mounted = false;
			dispose();
		}
	};
}

// (202:10) {#each tagsSorted[label].slice(0, expandedGroups.includes(label) ? tagsSorted[label].length : columns) as tag}
function create_each_block_2(ctx) {
	let div2;
	let div1;
	let tagtitle;
	let t0;
	let div0;
	let t1;
	let span;
	let t2_value = /*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].files.length + "";
	let t2;
	let t3;
	let t4;
	let ul;
	let t5;
	let current;
	let mounted;
	let dispose;

	tagtitle = new TagTitle({
			props: {
				tag: /*tag*/ ctx[35],
				inline: false,
				strong: true
			}
		});

	function click_handler_3(...args) {
		return /*click_handler_3*/ ctx[20](/*tag*/ ctx[35], ...args);
	}

	let if_block = /*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].files.length > 5 && create_if_block_4(ctx);
	let each_value_3 = /*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].files.slice(0, 5);
	let each_blocks = [];

	for (let i = 0; i < each_value_3.length; i += 1) {
		each_blocks[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
	}

	return {
		c() {
			div2 = element("div");
			div1 = element("div");
			create_component(tagtitle.$$.fragment);
			t0 = space();
			div0 = element("div");
			t1 = space();
			span = element("span");
			t2 = text(t2_value);
			t3 = space();
			if (if_block) if_block.c();
			t4 = space();
			ul = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t5 = space();
			attr(div0, "class", "flex-spacer svelte-1t8t6cm");
			attr(span, "class", "muted strong svelte-1t8t6cm");
			attr(div1, "class", "flex align-bottom link svelte-1t8t6cm");
			attr(ul, "class", "svelte-1t8t6cm");
			attr(div2, "style", "margin: " + columnMargin + "px; width: " + columnWidth + "px;");
		},
		m(target, anchor) {
			insert(target, div2, anchor);
			append(div2, div1);
			mount_component(tagtitle, div1, null);
			append(div1, t0);
			append(div1, div0);
			append(div1, t1);
			append(div1, span);
			append(span, t2);
			append(div2, t3);
			if (if_block) if_block.m(div2, null);
			append(div2, t4);
			append(div2, ul);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(ul, null);
			}

			append(div2, t5);
			current = true;

			if (!mounted) {
				dispose = listen(div1, "click", click_handler_3);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			const tagtitle_changes = {};
			if (dirty[0] & /*tagsSorted, groupsSorted, expandedGroups, columns*/ 1224) tagtitle_changes.tag = /*tag*/ ctx[35];
			tagtitle.$set(tagtitle_changes);
			if ((!current || dirty[0] & /*toShow, groupsSorted, tagsSorted, expandedGroups, columns*/ 1256) && t2_value !== (t2_value = /*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].files.length + "")) set_data(t2, t2_value);

			if (/*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].files.length > 5) {
				if (if_block) {
					if_block.p(ctx, dirty);

					if (dirty[0] & /*toShow, groupsSorted, tagsSorted, expandedGroups, columns*/ 1256) {
						transition_in(if_block, 1);
					}
				} else {
					if_block = create_if_block_4(ctx);
					if_block.c();
					transition_in(if_block, 1);
					if_block.m(div2, t4);
				}
			} else if (if_block) {
				group_outros();

				transition_out(if_block, 1, 1, () => {
					if_block = null;
				});

				check_outros();
			}

			if (dirty[0] & /*openFile, toShow, groupsSorted, tagsSorted, expandedGroups, columns*/ 17640) {
				each_value_3 = /*toShow*/ ctx[5][/*label*/ ctx[32]][/*tag*/ ctx[35]].files.slice(0, 5);
				let i;

				for (i = 0; i < each_value_3.length; i += 1) {
					const child_ctx = get_each_context_3(ctx, each_value_3, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block_3(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(ul, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value_3.length;
			}
		},
		i(local) {
			if (current) return;
			transition_in(tagtitle.$$.fragment, local);
			transition_in(if_block);
			current = true;
		},
		o(local) {
			transition_out(tagtitle.$$.fragment, local);
			transition_out(if_block);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div2);
			destroy_component(tagtitle);
			if (if_block) if_block.d();
			destroy_each(each_blocks, detaching);
			mounted = false;
			dispose();
		}
	};
}

// (232:8) {#if tagsSorted[label].length > columns && label.length > 0}
function create_if_block_2(ctx) {
	let show_if;
	let if_block_anchor;

	function select_block_type(ctx, dirty) {
		if (show_if == null || dirty[0] & /*expandedGroups, groupsSorted*/ 1088) show_if = !!!/*expandedGroups*/ ctx[10].includes(/*label*/ ctx[32]);
		if (show_if) return create_if_block_3;
		return create_else_block;
	}

	let current_block_type = select_block_type(ctx, [-1]);
	let if_block = current_block_type(ctx);

	return {
		c() {
			if_block.c();
			if_block_anchor = empty();
		},
		m(target, anchor) {
			if_block.m(target, anchor);
			insert(target, if_block_anchor, anchor);
		},
		p(ctx, dirty) {
			if (current_block_type === (current_block_type = select_block_type(ctx, dirty)) && if_block) {
				if_block.p(ctx, dirty);
			} else {
				if_block.d(1);
				if_block = current_block_type(ctx);

				if (if_block) {
					if_block.c();
					if_block.m(if_block_anchor.parentNode, if_block_anchor);
				}
			}
		},
		d(detaching) {
			if_block.d(detaching);
			if (detaching) detach(if_block_anchor);
		}
	};
}

// (235:10) {:else}
function create_else_block(ctx) {
	let div;
	let t0;
	let t1_value = /*label*/ ctx[32] + "";
	let t1;
	let mounted;
	let dispose;

	function click_handler_7(...args) {
		return /*click_handler_7*/ ctx[24](/*label*/ ctx[32], ...args);
	}

	return {
		c() {
			div = element("div");
			t0 = text("Show less in ");
			t1 = text(t1_value);
			attr(div, "class", "small mutedLink svelte-1t8t6cm");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, t0);
			append(div, t1);

			if (!mounted) {
				dispose = listen(div, "click", click_handler_7);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*groupsSorted*/ 64 && t1_value !== (t1_value = /*label*/ ctx[32] + "")) set_data(t1, t1_value);
		},
		d(detaching) {
			if (detaching) detach(div);
			mounted = false;
			dispose();
		}
	};
}

// (233:10) {#if !expandedGroups.includes(label)}
function create_if_block_3(ctx) {
	let div;
	let t0;
	let t1_value = /*tagsSorted*/ ctx[7][/*label*/ ctx[32]].length - /*columns*/ ctx[3] + "";
	let t1;
	let t2;
	let t3_value = /*label*/ ctx[32] + "";
	let t3;
	let mounted;
	let dispose;

	function click_handler_6(...args) {
		return /*click_handler_6*/ ctx[23](/*label*/ ctx[32], ...args);
	}

	return {
		c() {
			div = element("div");
			t0 = text("Show ");
			t1 = text(t1_value);
			t2 = text(" more in ");
			t3 = text(t3_value);
			attr(div, "class", "small mutedLink svelte-1t8t6cm");
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, t0);
			append(div, t1);
			append(div, t2);
			append(div, t3);

			if (!mounted) {
				dispose = listen(div, "click", click_handler_6);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*tagsSorted, groupsSorted, columns*/ 200 && t1_value !== (t1_value = /*tagsSorted*/ ctx[7][/*label*/ ctx[32]].length - /*columns*/ ctx[3] + "")) set_data(t1, t1_value);
			if (dirty[0] & /*groupsSorted*/ 64 && t3_value !== (t3_value = /*label*/ ctx[32] + "")) set_data(t3, t3_value);
		},
		d(detaching) {
			if (detaching) detach(div);
			mounted = false;
			dispose();
		}
	};
}

// (200:6) {#each groupsSorted as label}
function create_each_block_1(ctx) {
	let div;
	let t0;
	let t1;
	let hr;
	let current;

	let each_value_2 = /*tagsSorted*/ ctx[7][/*label*/ ctx[32]].slice(0, /*expandedGroups*/ ctx[10].includes(/*label*/ ctx[32])
	? /*tagsSorted*/ ctx[7][/*label*/ ctx[32]].length
	: /*columns*/ ctx[3]);

	let each_blocks = [];

	for (let i = 0; i < each_value_2.length; i += 1) {
		each_blocks[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
	}

	const out = i => transition_out(each_blocks[i], 1, 1, () => {
		each_blocks[i] = null;
	});

	let if_block = /*tagsSorted*/ ctx[7][/*label*/ ctx[32]].length > /*columns*/ ctx[3] && /*label*/ ctx[32].length > 0 && create_if_block_2(ctx);

	return {
		c() {
			div = element("div");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t0 = space();
			if (if_block) if_block.c();
			t1 = space();
			hr = element("hr");
			attr(div, "class", "flex flex-wrap svelte-1t8t6cm");
			attr(div, "style", "margin: 0 -" + columnMargin + "px;");
		},
		m(target, anchor) {
			insert(target, div, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div, null);
			}

			insert(target, t0, anchor);
			if (if_block) if_block.m(target, anchor);
			insert(target, t1, anchor);
			insert(target, hr, anchor);
			current = true;
		},
		p(ctx, dirty) {
			if (dirty[0] & /*toShow, groupsSorted, tagsSorted, expandedGroups, columns, openFile, sortCrossrefs, selectTags, selectedTags*/ 29932) {
				each_value_2 = /*tagsSorted*/ ctx[7][/*label*/ ctx[32]].slice(0, /*expandedGroups*/ ctx[10].includes(/*label*/ ctx[32])
				? /*tagsSorted*/ ctx[7][/*label*/ ctx[32]].length
				: /*columns*/ ctx[3]);

				let i;

				for (i = 0; i < each_value_2.length; i += 1) {
					const child_ctx = get_each_context_2(ctx, each_value_2, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
						transition_in(each_blocks[i], 1);
					} else {
						each_blocks[i] = create_each_block_2(child_ctx);
						each_blocks[i].c();
						transition_in(each_blocks[i], 1);
						each_blocks[i].m(div, null);
					}
				}

				group_outros();

				for (i = each_value_2.length; i < each_blocks.length; i += 1) {
					out(i);
				}

				check_outros();
			}

			if (/*tagsSorted*/ ctx[7][/*label*/ ctx[32]].length > /*columns*/ ctx[3] && /*label*/ ctx[32].length > 0) {
				if (if_block) {
					if_block.p(ctx, dirty);
				} else {
					if_block = create_if_block_2(ctx);
					if_block.c();
					if_block.m(t1.parentNode, t1);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}
		},
		i(local) {
			if (current) return;

			for (let i = 0; i < each_value_2.length; i += 1) {
				transition_in(each_blocks[i]);
			}

			current = true;
		},
		o(local) {
			each_blocks = each_blocks.filter(Boolean);

			for (let i = 0; i < each_blocks.length; i += 1) {
				transition_out(each_blocks[i]);
			}

			current = false;
		},
		d(detaching) {
			if (detaching) detach(div);
			destroy_each(each_blocks, detaching);
			if (detaching) detach(t0);
			if (if_block) if_block.d(detaching);
			if (detaching) detach(t1);
			if (detaching) detach(hr);
		}
	};
}

// (242:4) {#if totalCount < 20}
function create_if_block(ctx) {
	let strong;
	let t1;
	let div;
	let t2;
	let ul;
	let each_value = /*filesToShow*/ ctx[9];
	let each_blocks = [];

	for (let i = 0; i < each_value.length; i += 1) {
		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
	}

	return {
		c() {
			strong = element("strong");
			strong.textContent = "All notes";
			t1 = space();
			div = element("div");
			t2 = space();
			ul = element("ul");

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			attr(div, "class", "spacer svelte-1t8t6cm");
			attr(ul, "class", "svelte-1t8t6cm");
		},
		m(target, anchor) {
			insert(target, strong, anchor);
			insert(target, t1, anchor);
			insert(target, div, anchor);
			insert(target, t2, anchor);
			insert(target, ul, anchor);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(ul, null);
			}
		},
		p(ctx, dirty) {
			if (dirty[0] & /*openFile, filesToShow*/ 16896) {
				each_value = /*filesToShow*/ ctx[9];
				let i;

				for (i = 0; i < each_value.length; i += 1) {
					const child_ctx = get_each_context(ctx, each_value, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(ul, null);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value.length;
			}
		},
		d(detaching) {
			if (detaching) detach(strong);
			if (detaching) detach(t1);
			if (detaching) detach(div);
			if (detaching) detach(t2);
			if (detaching) detach(ul);
			destroy_each(each_blocks, detaching);
		}
	};
}

// (246:8) {#each filesToShow as file}
function create_each_block(ctx) {
	let li;
	let t_value = /*file*/ ctx[29].basename + "";
	let t;
	let mounted;
	let dispose;

	function click_handler_8(...args) {
		return /*click_handler_8*/ ctx[25](/*file*/ ctx[29], ...args);
	}

	return {
		c() {
			li = element("li");
			t = text(t_value);
			attr(li, "class", "note link svelte-1t8t6cm");
		},
		m(target, anchor) {
			insert(target, li, anchor);
			append(li, t);

			if (!mounted) {
				dispose = listen(li, "click", click_handler_8);
				mounted = true;
			}
		},
		p(new_ctx, dirty) {
			ctx = new_ctx;
			if (dirty[0] & /*filesToShow*/ 512 && t_value !== (t_value = /*file*/ ctx[29].basename + "")) set_data(t, t_value);
		},
		d(detaching) {
			if (detaching) detach(li);
			mounted = false;
			dispose();
		}
	};
}

function create_fragment(ctx) {
	let div6;
	let div5;
	let div2;
	let div0;
	let tagtitle0;
	let t0;
	let t1;
	let p0;
	let t2;
	let t3;
	let t4;
	let div1;
	let tagtitle1;
	let t5;
	let hr0;
	let t6;
	let div4;
	let p1;
	let t8;
	let div3;
	let t9;
	let t10;
	let t11;
	let hr1;
	let t12;
	let t13;
	let div5_style_value;
	let div6_resize_listener;
	let current;
	let mounted;
	let dispose;
	tagtitle0 = new TagTitle({ props: { tag: "All Tags" } });
	let each_value_6 = /*selectedTags*/ ctx[2];
	let each_blocks_1 = [];

	for (let i = 0; i < each_value_6.length; i += 1) {
		each_blocks_1[i] = create_each_block_6(get_each_context_6(ctx, each_value_6, i));
	}

	const out = i => transition_out(each_blocks_1[i], 1, 1, () => {
		each_blocks_1[i] = null;
	});

	tagtitle1 = new TagTitle({ props: { tag: "A/A" } });
	let each_value_5 = /*groupsSorted*/ ctx[6];
	let each_blocks = [];

	for (let i = 0; i < each_value_5.length; i += 1) {
		each_blocks[i] = create_each_block_5(get_each_context_5(ctx, each_value_5, i));
	}

	let if_block0 = (/*groupsSorted*/ ctx[6].length < 1 || /*groupsSorted*/ ctx[6].length == 0 && /*groupsSorted*/ ctx[6][0] == "") && create_if_block_5();
	let if_block1 = /*totalCount*/ ctx[8] > 3 && create_if_block_1(ctx);
	let if_block2 = /*totalCount*/ ctx[8] < 20 && create_if_block(ctx);

	return {
		c() {
			div6 = element("div");
			div5 = element("div");
			div2 = element("div");
			div0 = element("div");
			create_component(tagtitle0.$$.fragment);
			t0 = space();

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].c();
			}

			t1 = space();
			p0 = element("p");
			t2 = text(/*totalCount*/ ctx[8]);
			t3 = text(" notes");
			t4 = space();
			div1 = element("div");
			create_component(tagtitle1.$$.fragment);
			t5 = space();
			hr0 = element("hr");
			t6 = space();
			div4 = element("div");
			p1 = element("p");
			p1.textContent = "Favorite groups:";
			t8 = space();
			div3 = element("div");
			t9 = space();

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].c();
			}

			t10 = space();
			if (if_block0) if_block0.c();
			t11 = space();
			hr1 = element("hr");
			t12 = space();
			if (if_block1) if_block1.c();
			t13 = space();
			if (if_block2) if_block2.c();
			attr(div0, "class", "link svelte-1t8t6cm");
			attr(p0, "class", "muted small svelte-1t8t6cm");
			set_style(p0, "margin-left", "10px");
			set_style(div1, "visibility", "hidden");
			attr(div1, "class", "svelte-1t8t6cm");
			attr(div2, "class", "path svelte-1t8t6cm");
			attr(p1, "class", "small muted svelte-1t8t6cm");
			attr(div3, "class", "spacer svelte-1t8t6cm");
			attr(div4, "class", "flex align-center svelte-1t8t6cm");
			attr(div5, "style", div5_style_value = "width: " + /*contentWidth*/ ctx[11] + "px; margin: 0 auto;");
			add_render_callback(() => /*div6_elementresize_handler*/ ctx[26].call(div6));
		},
		m(target, anchor) {
			insert(target, div6, anchor);
			append(div6, div5);
			append(div5, div2);
			append(div2, div0);
			mount_component(tagtitle0, div0, null);
			append(div2, t0);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				each_blocks_1[i].m(div2, null);
			}

			append(div2, t1);
			append(div2, p0);
			append(p0, t2);
			append(p0, t3);
			append(div2, t4);
			append(div2, div1);
			mount_component(tagtitle1, div1, null);
			append(div5, t5);
			append(div5, hr0);
			append(div5, t6);
			append(div5, div4);
			append(div4, p1);
			append(div4, t8);
			append(div4, div3);
			append(div4, t9);

			for (let i = 0; i < each_blocks.length; i += 1) {
				each_blocks[i].m(div4, null);
			}

			append(div4, t10);
			if (if_block0) if_block0.m(div4, null);
			append(div5, t11);
			append(div5, hr1);
			append(div5, t12);
			if (if_block1) if_block1.m(div5, null);
			append(div5, t13);
			if (if_block2) if_block2.m(div5, null);
			div6_resize_listener = add_resize_listener(div6, /*div6_elementresize_handler*/ ctx[26].bind(div6));
			current = true;

			if (!mounted) {
				dispose = listen(div0, "click", /*click_handler*/ ctx[17]);
				mounted = true;
			}
		},
		p(ctx, dirty) {
			if (dirty[0] & /*selectTags, selectedTags*/ 4100) {
				each_value_6 = /*selectedTags*/ ctx[2];
				let i;

				for (i = 0; i < each_value_6.length; i += 1) {
					const child_ctx = get_each_context_6(ctx, each_value_6, i);

					if (each_blocks_1[i]) {
						each_blocks_1[i].p(child_ctx, dirty);
						transition_in(each_blocks_1[i], 1);
					} else {
						each_blocks_1[i] = create_each_block_6(child_ctx);
						each_blocks_1[i].c();
						transition_in(each_blocks_1[i], 1);
						each_blocks_1[i].m(div2, t1);
					}
				}

				group_outros();

				for (i = each_value_6.length; i < each_blocks_1.length; i += 1) {
					out(i);
				}

				check_outros();
			}

			if (!current || dirty[0] & /*totalCount*/ 256) set_data(t2, /*totalCount*/ ctx[8]);

			if (dirty[0] & /*$settingsStore, groupsSorted, toggleFavoriteGroup*/ 32848) {
				each_value_5 = /*groupsSorted*/ ctx[6];
				let i;

				for (i = 0; i < each_value_5.length; i += 1) {
					const child_ctx = get_each_context_5(ctx, each_value_5, i);

					if (each_blocks[i]) {
						each_blocks[i].p(child_ctx, dirty);
					} else {
						each_blocks[i] = create_each_block_5(child_ctx);
						each_blocks[i].c();
						each_blocks[i].m(div4, t10);
					}
				}

				for (; i < each_blocks.length; i += 1) {
					each_blocks[i].d(1);
				}

				each_blocks.length = each_value_5.length;
			}

			if (/*groupsSorted*/ ctx[6].length < 1 || /*groupsSorted*/ ctx[6].length == 0 && /*groupsSorted*/ ctx[6][0] == "") {
				if (if_block0) ; else {
					if_block0 = create_if_block_5();
					if_block0.c();
					if_block0.m(div4, null);
				}
			} else if (if_block0) {
				if_block0.d(1);
				if_block0 = null;
			}

			if (/*totalCount*/ ctx[8] > 3) {
				if (if_block1) {
					if_block1.p(ctx, dirty);

					if (dirty[0] & /*totalCount*/ 256) {
						transition_in(if_block1, 1);
					}
				} else {
					if_block1 = create_if_block_1(ctx);
					if_block1.c();
					transition_in(if_block1, 1);
					if_block1.m(div5, t13);
				}
			} else if (if_block1) {
				group_outros();

				transition_out(if_block1, 1, 1, () => {
					if_block1 = null;
				});

				check_outros();
			}

			if (/*totalCount*/ ctx[8] < 20) {
				if (if_block2) {
					if_block2.p(ctx, dirty);
				} else {
					if_block2 = create_if_block(ctx);
					if_block2.c();
					if_block2.m(div5, null);
				}
			} else if (if_block2) {
				if_block2.d(1);
				if_block2 = null;
			}

			if (!current || dirty[0] & /*contentWidth*/ 2048 && div5_style_value !== (div5_style_value = "width: " + /*contentWidth*/ ctx[11] + "px; margin: 0 auto;")) {
				attr(div5, "style", div5_style_value);
			}
		},
		i(local) {
			if (current) return;
			transition_in(tagtitle0.$$.fragment, local);

			for (let i = 0; i < each_value_6.length; i += 1) {
				transition_in(each_blocks_1[i]);
			}

			transition_in(tagtitle1.$$.fragment, local);
			transition_in(if_block1);
			current = true;
		},
		o(local) {
			transition_out(tagtitle0.$$.fragment, local);
			each_blocks_1 = each_blocks_1.filter(Boolean);

			for (let i = 0; i < each_blocks_1.length; i += 1) {
				transition_out(each_blocks_1[i]);
			}

			transition_out(tagtitle1.$$.fragment, local);
			transition_out(if_block1);
			current = false;
		},
		d(detaching) {
			if (detaching) detach(div6);
			destroy_component(tagtitle0);
			destroy_each(each_blocks_1, detaching);
			destroy_component(tagtitle1);
			destroy_each(each_blocks, detaching);
			if (if_block0) if_block0.d();
			if (if_block1) if_block1.d();
			if (if_block2) if_block2.d();
			div6_resize_listener();
			mounted = false;
			dispose();
		}
	};
}

const columnWidth = 250;
const columnMargin = 20;

function instance($$self, $$props, $$invalidate) {
	let columns;
	let contentWidth;

	let $settingsStore,
		$$unsubscribe_settingsStore = noop,
		$$subscribe_settingsStore = () => ($$unsubscribe_settingsStore(), $$unsubscribe_settingsStore = subscribe(settingsStore, $$value => $$invalidate(4, $settingsStore = $$value)), settingsStore);

	$$self.$$.on_destroy.push(() => $$unsubscribe_settingsStore());

	var __awaiter = this && this.__awaiter || function (thisArg, _arguments, P, generator) {
		function adopt(value) {
			return value instanceof P
			? value
			: new P(function (resolve) {
						resolve(value);
					});
		}

		return new (P || (P = Promise))(function (resolve, reject) {
				function fulfilled(value) {
					try {
						step(generator.next(value));
					} catch(e) {
						reject(e);
					}
				}

				function rejected(value) {
					try {
						step(generator["throw"](value));
					} catch(e) {
						reject(e);
					}
				}

				function step(result) {
					result.done
					? resolve(result.value)
					: adopt(result.value).then(fulfilled, rejected);
				}

				step((generator = generator.apply(thisArg, _arguments || [])).next());
			});
	};

	
	
	let { settingsStore } = $$props;
	$$subscribe_settingsStore();
	const totalColumnWidth = columnWidth + columnMargin * 2;
	let clientWidth;
	let toShow = {};
	let groupsSorted = [];
	let tagsSorted = {};
	let totalCount = 0;
	let filesToShow = [];
	let selectedTags = [];

	function selectTags(selectTags) {
		$$invalidate(5, toShow = {});
		let _toShow = {};
		let groupCounts = {};
		let tagCounts = {};
		let _totalCount = 0;
		let _filesToShow = [];
		let allFiles = window.app.vault.getMarkdownFiles();
		let allFileTags = {};

		allFiles.forEach(file => {
			let fileTags = obsidian.getAllTags(window.app.metadataCache.getFileCache(file));
			allFileTags[file.name] = fileTags;

			if (selectTags.every(t => fileTags.includes(t))) {
				fileTags.forEach(tag => {
					var _a;

					if (selectTags.includes(tag)) {
						return;
					}

					let parts = tagParts(tag);
					let label = (_a = parts.label) !== null && _a !== void 0 ? _a : "";
					let title = parts.title;

					if (!_toShow[label]) {
						_toShow[label] = {};
					}

					if (!_toShow[label][tag]) {
						_toShow[label][tag] = {
							displayName: title,
							files: [],
							crossrefs: {}
						};
					}

					_toShow[label][tag].files.push(file);

					if (!tagCounts[label]) {
						tagCounts[label] = {};
					}

					groupCounts[label] = (groupCounts[label] || 0) + 1;
					tagCounts[label][tag] = (tagCounts[label][tag] || 0) + 1;
				});

				_filesToShow.push(file);
				_totalCount += 1;
			}
		});

		$$invalidate(6, groupsSorted = Object.keys(_toShow).sort((a, b) => groupCounts[b] + Object.keys(tagCounts[b]).length - (groupCounts[a] + Object.keys(tagCounts[a]).length))); // tagCounts included to prioritize groups that have more columns
		let _favoriteGroups = $settingsStore.favoriteGroups.sort((a, b) => (groupCounts[a] || 0) + Object.keys(tagCounts[a] || {}).length - (groupCounts[b] || 0) + Object.keys(tagCounts[b] || {}).length);

		_favoriteGroups.forEach(group => {
			const index = groupsSorted.indexOf(group);

			if (index > -1) {
				groupsSorted.splice(index, 1);
				groupsSorted.unshift(group);
			}
		});

		const index = groupsSorted.indexOf("");

		if (index > -1) {
			groupsSorted.splice(index, 1);
			groupsSorted.push("");
		}

		Object.keys(_toShow).forEach(group => {
			$$invalidate(7, tagsSorted[group] = Object.keys(_toShow[group]).sort((a, b) => tagCounts[group][b] - tagCounts[group][a]), tagsSorted);

			Object.keys(_toShow[group]).forEach(tag => {
				let files = _toShow[group][tag].files;
				let crossrefs = {};

				files.forEach(file => {
					allFileTags[file.name].forEach(tag2 => {
						var _a;

						if (tag2 === tag) {
							return;
						}

						if (selectTags.includes(tag2)) {
							return;
						}

						crossrefs[tag2] = ((_a = crossrefs[tag2]) !== null && _a !== void 0
						? _a
						: 0) + 1;
					});
				});

				_toShow[group][tag].crossrefs = crossrefs;
			});
		});

		$$invalidate(5, toShow = _toShow);
		$$invalidate(8, totalCount = _totalCount);
		$$invalidate(9, filesToShow = _filesToShow);
		$$invalidate(2, selectedTags = selectTags);
	}

	onMount(() => selectTags([]));

	function sortCrossrefs(crossrefs) {
		// let favorite = Object.keys(crossrefs).filter(t => favoriteGroups.inc)
		let sorted = Object.keys(crossrefs).sort((a, b) => crossrefs[b] - crossrefs[a]);

		sorted.slice().reverse().forEach(tag => {
			if ($settingsStore.favoriteGroups.find(group => tag.startsWith("#" + group))) {
				sorted.splice(sorted.indexOf(tag), 1);
				sorted.unshift(tag);
			}
		});

		return sorted;
	}

	function openFile(e, file) {
		return __awaiter(this, void 0, void 0, function* () {
			let inNewSplit = e.metaKey;
			const mode = window.app.vault.getConfig("defaultViewMode");

			const leaf = inNewSplit
			? window.app.workspace.splitActiveLeaf()
			: window.app.workspace.getUnpinnedLeaf();

			yield leaf.openFile(file, { active: true, mode });
		}); // activeFile.setFile(basename);
	}

	// let storedSettings: any = get(settingsStore)
	// let favoriteGroups: string[] = storedSettings?.featuredGroups || []
	function toggleFavoriteGroup(group) {
		settingsStore.update(settings => {
			let favoriteGroups = settings.favoriteGroups;
			const index = favoriteGroups.indexOf(group);

			if (index > -1) {
				favoriteGroups.splice(index, 1);
			} else {
				favoriteGroups.push(group); //favoriteGroups = favoriteGroups
			} //favoriteGroups = [...favoriteGroups, group]

			return Object.assign(Object.assign({}, settings), { favoriteGroups });
		}); // selectTags(selectedTags)
	}

	let expandedGroups = [""];

	function toggleExpandedGroup(group) {
		const index = expandedGroups.indexOf(group);

		if (index > -1) {
			expandedGroups.splice(index, 1);
			$$invalidate(10, expandedGroups);
		} else {
			$$invalidate(10, expandedGroups = [...expandedGroups, group]);
		}
	}

	const click_handler = e => selectTags([]);

	const click_handler_1 = (tag, index, e) => e.metaKey
	? selectTags([tag])
	: selectTags(selectedTags.slice(0, index + 1));

	const click_handler_2 = (label, e) => toggleFavoriteGroup(label);
	const click_handler_3 = (tag, e) => selectTags([...selectedTags, tag]);
	const click_handler_4 = (tag, tag2, e) => selectTags([...selectedTags, tag, tag2]);
	const click_handler_5 = (file, e) => openFile(e, file);
	const click_handler_6 = (label, e) => toggleExpandedGroup(label);
	const click_handler_7 = (label, e) => toggleExpandedGroup(label);
	const click_handler_8 = (file, e) => openFile(e, file);

	function div6_elementresize_handler() {
		clientWidth = this.clientWidth;
		$$invalidate(1, clientWidth);
	}

	$$self.$$set = $$props => {
		if ("settingsStore" in $$props) $$subscribe_settingsStore($$invalidate(0, settingsStore = $$props.settingsStore));
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty[0] & /*clientWidth*/ 2) {
			$$invalidate(3, columns = Math.max(1, Math.trunc(clientWidth / totalColumnWidth)));
		}

		if ($$self.$$.dirty[0] & /*columns*/ 8) {
			$$invalidate(11, contentWidth = columns * totalColumnWidth);
		}

		if ($$self.$$.dirty[0] & /*$settingsStore, selectedTags*/ 20) {
			if ($settingsStore) {
				selectTags(selectedTags);
			}
		}
	};

	return [
		settingsStore,
		clientWidth,
		selectedTags,
		columns,
		$settingsStore,
		toShow,
		groupsSorted,
		tagsSorted,
		totalCount,
		filesToShow,
		expandedGroups,
		contentWidth,
		selectTags,
		sortCrossrefs,
		openFile,
		toggleFavoriteGroup,
		toggleExpandedGroup,
		click_handler,
		click_handler_1,
		click_handler_2,
		click_handler_3,
		click_handler_4,
		click_handler_5,
		click_handler_6,
		click_handler_7,
		click_handler_8,
		div6_elementresize_handler
	];
}

class TagMenu extends SvelteComponent {
	constructor(options) {
		super();
		if (!document.getElementById("svelte-1t8t6cm-style")) add_css();
		init(this, options, instance, create_fragment, safe_not_equal, { settingsStore: 0 }, [-1, -1]);
	}
}

class CRNView extends obsidian.ItemView {
    constructor(leaf, settingsStore) {
        super(leaf);
        this.settingsStore = settingsStore;
    }
    getViewType() {
        return VIEW_TYPE;
    }
    getDisplayText() {
        return "Cross-reference Navigation";
    }
    getIcon() {
        return "go-to-file";
    }
    onClose() {
        if (this.tagMenu) {
            this.tagMenu.$destroy();
        }
        return Promise.resolve();
    }
    async onOpen() {
        this.tagMenu = new TagMenu({
            target: this.contentEl,
            props: {
                settingsStore: this.settingsStore
            },
        });
    }
}

const subscriber_queue = [];
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = [];
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (let i = 0; i < subscribers.length; i += 1) {
                    const s = subscribers[i];
                    s[1]();
                    subscriber_queue.push(s, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.push(subscriber);
        if (subscribers.length === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) {
                subscribers.splice(index, 1);
            }
            if (subscribers.length === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}

const defaultSettings = {
    favoriteGroups: ["status", "activity"]
};
async function createSettingsStore(plugin) {
    const initialData = await plugin.loadData();
    const { subscribe, set, update } = writable(Object.assign(Object.assign({}, defaultSettings), initialData));
    return {
        subscribe,
        set: (newSettings) => {
            set(newSettings);
            plugin.saveData(newSettings);
        },
        update: (updater) => {
            let newSettings = updater(get_store_value({ subscribe }));
            set(newSettings);
            plugin.saveData(newSettings);
        }
    };
}

class CalendarPlugin extends obsidian.Plugin {
    onunload() {
        this.app.workspace
            .getLeavesOfType(VIEW_TYPE)
            .forEach((leaf) => leaf.detach());
    }
    async onload() {
        this.settingsStore = await createSettingsStore(this);
        this.registerView(VIEW_TYPE, (leaf) => (this.view = new CRNView(leaf, this.settingsStore)));
        this.addCommand({
            id: "show-refnav-view",
            name: "Open Cross-references View",
            callback: () => {
                const leaf = this.app.workspace.activeLeaf;
                leaf.open(new CRNView(leaf, this.settingsStore));
            },
        });
    }
}

module.exports = CalendarPlugin;

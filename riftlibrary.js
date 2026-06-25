const GEOMETRY_KEY = "riftlibrary:geometry";
const BOUNDING_BOX_KEY = "bounding_boxes";

//basically the format added by this plugin
let format;
//parser for the format
let codec;
//allow for import of model
let importModel;
//allow for export of model
let exportModel;
//flag for cached original bounding box behaviors
let hasOldBBCached = false;
//cached original bounding box behaviors
let originalBoundingBoxResize;
let originalBoundingBoxExtend;
let originalBoundingBoxFunctionElementPanel;
let originalBoundingBoxUpdateTransform;
let originalTransformerUpdate;
let boundingBoxFunctionProperty;
let boundingBoxTagsProperty;
let boundingBoxDamageMultiplierProperty;

function setBoundingBoxWidth(box, width) {
    width = Math.max(0, width);
    [0, 2].forEach(axis => {
        let center = (box.from[axis] + box.to[axis]) / 2;
        box.from[axis] = center - width / 2;
        box.to[axis] = center + width / 2;
    });

    if (box.mesh) {
        box.preview_controller.updateGeometry(box);
        box.preview_controller.updateTransform(box);
    }
    Canvas.updateView({elements: [box], element_aspects: {geometry: true, transform: true}, selection: true});
    TickUpdates.selection = true;
}

//-----bounding box behavior modification starts here-----
function patchBoundingBoxBehavior() {
    //---if theres cached info, block---
    if (hasOldBBCached) return;

    //---cache original behaviors---
    originalBoundingBoxResize = BoundingBox.prototype.resize;
    originalBoundingBoxExtend = BoundingBox.prototype.extend;
    originalBoundingBoxFunctionElementPanel = BoundingBox.properties.function.inputs.element_panel;
    originalBoundingBoxUpdateTransform = BoundingBox.preview_controller.updateTransform;

    //---remove original elements---
    delete BoundingBox.properties.function.inputs.element_panel;

    //---define new properties for bounding box editing---
    boundingBoxFunctionProperty = new Property(BoundingBox, "string", "bounding_box_function", {
        default: "collision",
        export: false,
        condition: () => Format === format,
        inputs: {
            element_panel: {
                input: {
                    type: "select",
                    label: "Function",
                    default: "collision",
                    options: {
                        collision: "Collision",
                        offense: "Offense"
                    }
                },
                onChange(value, boxes) {
                    boxes.forEach(box => {
                        box.bounding_box_function = value === "offense" ? "offense" : "collision";
                        box.function = [box.bounding_box_function === "offense" ? "hitbox" : "collision"];
                        if (box.bounding_box_function === "offense") box.bounding_box_damage_multiplier = "";
                        else if (!box.bounding_box_damage_multiplier) box.bounding_box_damage_multiplier = "1";
                    });
                    if (typeof updateSelection === "function") updateSelection();
                }
            }
        }
    });
    boundingBoxTagsProperty = new Property(BoundingBox, "string", "bounding_box_tags", {
        default: "",
        export: false,
        condition: () => Format === format,
        inputs: {
            element_panel: {
                input: {
                    type: "text",
                    label: "Hitbox Tags"
                }
            }
        }
    });
    boundingBoxDamageMultiplierProperty = new Property(BoundingBox, "string", "bounding_box_damage_multiplier", {
        default: "1",
        export: false,
        condition: () => {
            let selected = Outliner.selected[0];
            let func = selected?.bounding_box_function || (selected?.function?.includes("hitbox") ? "offense" : "collision");
            return Format === format && func !== "offense";
        },
        inputs: {
            element_panel: {
                input: {
                    type: "text",
                    label: "Damage Multiplier"
                }
            }
        }
    });
    Blockbench.dispatchEvent("register_element_type");

    //---replace other behaviors with more desirable ones for this plugin---
    BoundingBox.prototype.resize = function(value, axis, negative, allow_negative, bidirectional) {
        let pending = this.riftlibrary_pending_resize;
        let now = Date.now();
        if ((axis === 0 || axis === 2) && allow_negative === true && value instanceof Function) {
            delete this.riftlibrary_pending_resize;
            setBoundingBoxWidth(this, Math.abs(value(this.size(axis))));
            return this;
        }
        if (pending && now - pending.time > 100) {
            delete this.riftlibrary_pending_resize;
            pending = null;
        }

        if (pending) {
            delete this.riftlibrary_pending_resize;
            if (bidirectional === true && ((pending.axis === 0 && axis === 2) || (pending.axis === 2 && axis === 0))) {
                this.from = pending.from.slice();
                this.to = pending.to.slice();
                setBoundingBoxWidth(
                    this,
                    Math.max(0, Math.max(Math.abs(this.to[0] - this.from[0]), Math.abs(this.to[2] - this.from[2])) + pending.value * 2)
                );
            }
            else if (axis === 1 && !bidirectional) {
                return originalBoundingBoxResize.call(this, value, axis, negative, allow_negative, bidirectional);
            }
            return this;
        }

        if (bidirectional === true) {
            this.riftlibrary_pending_resize = {
                axis,
                value,
                allow_negative,
                from: this.from.slice(),
                to: this.to.slice(),
                time: now
            };
            return this;
        }

        return axis === 1 ? originalBoundingBoxResize.call(this, value, axis, negative, allow_negative, bidirectional) : this;
    };
    BoundingBox.prototype.extend = function(data) {
        let result = originalBoundingBoxExtend.call(this, data);
        let value = Array.isArray(this.function) ? this.function[0] : this.function;
        this.bounding_box_function = value === "offense" || value === "hitbox" ? "offense" : "collision";
        this.function = [this.bounding_box_function === "offense" ? "hitbox" : "collision"];
        if (this.bounding_box_function === "offense") this.bounding_box_damage_multiplier = "";
        else if (!this.bounding_box_damage_multiplier) this.bounding_box_damage_multiplier = "1";
        if (this.mesh) {
            this.preview_controller.updateGeometry(this);
            this.preview_controller.updateTransform(this);
        }
        return result;
    };
    BoundingBox.preview_controller.updateTransform = function(box) {
        let result = originalBoundingBoxUpdateTransform.call(this, box);
        if (Format === format && box.mesh) this.updateGeometry(box);
        return result;
    };
    if (window.Transformer && !originalTransformerUpdate) {
        originalTransformerUpdate = Transformer.update;
        Transformer.update = function() {
            let result = originalTransformerUpdate.apply(this, arguments);
            let hidden = ["X", "NX", "Z", "NZ", "XY", "YZ", "E"];
            let visible = ["Y", "NY", "XZ"];
            let boundingBoxResize = Format === format
                && Toolbox.selected?.id === "resize_tool"
                && Outliner.selected.length
                && Outliner.selected.every(element => element instanceof BoundingBox);

            this.children.forEach(gizmo => {
                ["handles", "pickers"].forEach(type => {
                    gizmo[type]?.children?.forEach(child => {
                        if (!hidden.includes(child.name) && !visible.includes(child.name)) return;
                        if (child.riftlibrary_layer_mask === undefined) child.riftlibrary_layer_mask = child.layers.mask;
                        child.visible = !boundingBoxResize || visible.includes(child.name);
                        child.layers.mask = child.visible ? child.riftlibrary_layer_mask : 0;
                    });
                });
            });
            return result;
        };
    }

    //---set flag---
    hasOldBBCached = true;
}

function restoreBoundingBoxBehavior() {
    //---restore old bounding box setter behaviors---
    if (originalBoundingBoxResize) {
        BoundingBox.prototype.resize = originalBoundingBoxResize;
        originalBoundingBoxResize = null;
    }
    if (originalBoundingBoxExtend) {
        BoundingBox.prototype.extend = originalBoundingBoxExtend;
        originalBoundingBoxExtend = null;
    }
    if (originalBoundingBoxFunctionElementPanel) {
        BoundingBox.properties.function.inputs.element_panel = originalBoundingBoxFunctionElementPanel;
        originalBoundingBoxFunctionElementPanel = null;
    }
    let changedElementProperties = false;
    if (boundingBoxFunctionProperty) {
        boundingBoxFunctionProperty.delete();
        boundingBoxFunctionProperty = null;
        changedElementProperties = true;
    }
    if (boundingBoxTagsProperty) {
        boundingBoxTagsProperty.delete();
        boundingBoxTagsProperty = null;
        changedElementProperties = true;
    }
    if (boundingBoxDamageMultiplierProperty) {
        boundingBoxDamageMultiplierProperty.delete();
        boundingBoxDamageMultiplierProperty = null;
        changedElementProperties = true;
    }
    if (changedElementProperties) Blockbench.dispatchEvent("register_element_type");
    if (originalBoundingBoxUpdateTransform) {
        BoundingBox.preview_controller.updateTransform = originalBoundingBoxUpdateTransform;
        originalBoundingBoxUpdateTransform = null;
    }
    if (originalTransformerUpdate) {
        Transformer.children.forEach(gizmo => {
            ["handles", "pickers"].forEach(type => {
                gizmo[type]?.children?.forEach(child => {
                    if (child.riftlibrary_layer_mask !== undefined) {
                        child.visible = true;
                        child.layers.mask = child.riftlibrary_layer_mask;
                        delete child.riftlibrary_layer_mask;
                    }
                });
            });
        });
        Transformer.update = originalTransformerUpdate;
        originalTransformerUpdate = null;
    }

    //---set flag---
    hasOldBBCached = false;
}
//-----bounding box behavior modification ends here-----

/**
 * Made to help out in enforcing uniqueness in bounding box names
 * by changing other collision boxes that share the same name with
 * this to have an incrementing number similar with bone groups
 * */
function uniqueBoundingBoxName(name, usedNames) {
    let base = name || "bounding_box";
    let unique = base;
    let index = 2;
    while (usedNames.has(unique)) unique = `${base}${index++}`;
    usedNames.add(unique);
    return unique;
}

/**
 * For exporting bounding box data
 * */
function compileBoundingBox(box, usedNames) {
    let func = box.bounding_box_function === "offense" || box.bounding_box_function === "collision"
        ? box.bounding_box_function
        : box.function?.includes("hitbox") ? "offense" : "collision";
    let data = {
        name: uniqueBoundingBoxName(box.name, usedNames),
        origin: box.from.slice(),
        size: [Math.max(Math.abs(box.to[0] - box.from[0]), Math.abs(box.to[2] - box.from[2])), Math.abs(box.to[1] - box.from[1])],
        function: func
    };
    let tags = (Array.isArray(box.bounding_box_tags) ? box.bounding_box_tags : String(box.bounding_box_tags || "").split(","))
        .map(tag => String(tag).trim())
        .filter(Boolean);
    let multiplier = box.bounding_box_damage_multiplier === undefined || box.bounding_box_damage_multiplier === null
        ? ""
        : String(box.bounding_box_damage_multiplier).trim();
    if (tags.length) data.tags = tags;
    if (func === "collision" && multiplier) {
        let number = Number(multiplier);
        data.damage_multiplier = Number.isFinite(number) ? number : multiplier;
    }
    return data;
}

/**
 * For importing bounding box data
 * */
function parseBoundingBox(data, parent) {
    //---definition of width and height from given data---
    let width = Math.abs(data.size?.[0] || data.width || 1);
    let height = Math.abs(data.size?.[1] || data.height || 1);

    //---definition of bounds from given data---
    let bounds;
    //if theres origin and size, create to and from for use in blockbench
    if (data.origin && data.size) {
        let origin = data.origin;
        bounds = {
            from: origin.slice(),
            to: [origin[0] + width, origin[1] + height, origin[2] + width]
        };
    }
    //if theres from and to for some reason, use them
    else if (data.from && data.to) {
        bounds = {
            from: data.from.slice(),
            to: data.to.slice()
        };
    }
    //if there's nothing else, we assume origin as 0, 0, 0 and size as 1, 1
    else {
        let origin = data.origin || [0, 0, 0];
        bounds = {
            from: [origin[0], origin[1], origin[2]],
            to: [origin[0] + width, origin[1] + height, origin[2] + width]
        };
    }

    //---definition of function param---
    let functionArray = data.function;
    let func = Array.isArray(functionArray)
        ? functionArray.includes("hitbox") || functionArray.includes("offense") ? "offense" : "collision"
        : functionArray === "offense" || functionArray === "hitbox" ? "offense" : "collision";

    //---final box creation---
    let names = new Set(BoundingBox.all.map(box => box.name));
    let box = new BoundingBox({
        name: uniqueBoundingBoxName(data.name, names),
        from: bounds.from,
        to: bounds.to,
        function: [func === "offense" ? "hitbox" : "collision"]
    }).addTo(parent);
    box.bounding_box_function = func;
    box.bounding_box_tags = Array.isArray(data.tags) ? data.tags.filter(tag => typeof tag === "string").join(", ") : "";
    box.bounding_box_damage_multiplier = func === "collision" && data.damage_multiplier !== undefined
        ? String(data.damage_multiplier)
        : func === "collision" ? "1" : "";
    box.createUniqueName();
    box.init();
}

/**
 * Plugin entry
 * */
Plugin.register("riftlibrary", {
    title: "RiftLibrary Blockbench Extension",
    author: "ANightDazingZoroark",
    icon: "bar_chart",
    description: "The Blockbench extension for RiftLibrary, a 1.12.2 mod for the Cleanroom modloader.",
    version: "2.0.0",
    variant: "both",
    onload() {
        //define codec
        codec = new Codec("riftlibrary_model", {
            name: "RiftLibrary Model",
            extension: "json",
            load_filter: {
                type: "json",
                extensions: ["json"],
                condition: model => model[GEOMETRY_KEY]
            },
            load(model, file, args = {}) {
                if (!args.import_to_current_project) setupProject(format);
                this.parse(model, file.path, args);
            },
            parse(model, path, args = {}) {
                if (Format === format) patchBoundingBoxBehavior();
                let geometry = model[GEOMETRY_KEY]?.[0];
                if (!geometry) return;

                //normal geometry parse
                Codecs.bedrock.parseGeometry({object: geometry, name: geometry.description?.identifier || ""}, args);

                //special additional parsing for bounding boxes
                let groups = {};
                Group.all.forEach(group => groups[group.name] = group);

                geometry[BOUNDING_BOX_KEY]?.forEach(box => parseBoundingBox(box, "root"));
                geometry.bones?.forEach(bone => {
                    bone[BOUNDING_BOX_KEY]?.forEach(box => parseBoundingBox(box, groups[bone.name] || "root"));
                });
            },
            compile(options = {}) {
                let model = Codecs.bedrock.compile({...options, raw: true});

                //normal geometry parse
                let geometry = model["minecraft:geometry"]?.[0];

                //special additional compilation for bounding boxes
                if (geometry) {
                    let boxes = new Map();
                    let names = new Set();
                    BoundingBox.all.forEach(box => {
                        let bone = box.parent instanceof Group ? box.parent.name : "";
                        if (!boxes.has(bone)) boxes.set(bone, []);
                        boxes.get(bone).push(compileBoundingBox(box, names));
                    });

                    if (boxes.has("")) geometry[BOUNDING_BOX_KEY] = boxes.get("");
                    geometry.bones?.forEach(bone => {
                        if (boxes.has(bone.name)) bone[BOUNDING_BOX_KEY] = boxes.get(bone.name);
                    });
                }

                //replace "minecraft:geometry" with "riftlibrary:geometry", thats le
                //new parent object for all models for the mod
                model[GEOMETRY_KEY] = model["minecraft:geometry"];
                delete model["minecraft:geometry"];

                //return
                return options.raw ? model : autoStringify(model);
            },
            fileName: () => Codecs.bedrock.fileName()
        });

        //define format
        format = new ModelFormat("riftlibrary_model", {
            name: "RiftLibrary Model",
            description: "Model meant for use in mods that use RiftLibrary",
            icon: "bar_chart",
            category: "minecraft",
            target: "Minecraft: Java Edition",
            box_uv: true,
            optional_box_uv: true,
            single_texture: true,
            bone_rig: true,
            centered_grid: true,
            rotate_cubes: true,
            locators: true,
            uv_rotation: true,
            select_texture_for_particles: true,
            texture_mcmeta: true,
            animation_files: true,
            display_mode: false,
            animation_mode: true,
            bounding_boxes: true,
            codec: codec,
            animation_codec: Codecs.bedrock.format.animation_codec,
            onActivation() {
                patchBoundingBoxBehavior();
            },
            onDeactivation() {
                restoreBoundingBoxBehavior();
            }
        });

        //define importModel button and action
        importModel = new Action("import_riftlibrary_model", {
            name: "Import RiftLibrary Model",
            icon: "file_upload",
            condition: () => Format === format,
            click: () => Blockbench.import(
                {
                    type: "RiftLibrary Model",
                    extensions: ["json"],
                    multiple: false,
                    resource_id: "model"
                },
                files => {
                    setupProject(format);
                    codec.parse(JSON.parse(files[0].content), files[0].path);
                }
            )
        });
        MenuBar.addAction(importModel, "file.import");

        //define exportModel button and action
        exportModel = new Action("export_riftlibrary_model", {
            name: "Export RiftLibrary Model",
            icon: "file_upload",
            condition: {formats: ["riftlibrary_model"]},
            click: () => codec.export()
        });
        MenuBar.addAction(exportModel, "file.export");
    },
    onunload() {
        //reset bounding box modification behaviors to normal
        restoreBoundingBoxBehavior();

        //delete all le other new elements
        format.delete();
        codec.delete();
        importModel.delete();
        exportModel.delete();
    }
});

const GEOMETRY_KEY = "riftlibrary:geometry";
const BOUNDING_BOX_KEY = "bounding_boxes";
const RIFTLIBRARY_MOLANG_CUSTOM_FUNCTIONS = [
    "function.send_message",
    "function.create_offense_hitbox_by_tag",
    "function.destroy_offense_hitbox_by_tag"
];
const MOLANG_COMPLEX_NO_RETURN_WARNING = "Complex expression with no return value. Remove the semicolon or add a return statement";
const RIFTLIBRARY_MOLANG_CUSTOM_FUNCTION_PATTERN = new RegExp(
    "^\\s*(?:" + RIFTLIBRARY_MOLANG_CUSTOM_FUNCTIONS
        .map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|") + ")\\s*\\([\\s\\S]*\\)\\s*;?\\s*$"
);

//basically the format added by this plugin
let format;
//parser for the format
let codec;
//allow for import of model
let importModel;
//allow for export of model
let exportModel;
//allow changing visual model scale
let changeModelScaleAction;
//flag for cached original bounding box behaviors
let hasOldBBCached = false;
//cached original bounding box behaviors
let originalBoundingBoxResize;
let originalBoundingBoxExtend;
let originalBoundingBoxInit;
let originalBoundingBoxFunctionElementPanel;
let originalBoundingBoxUpdateTransform;
let originalBoundingBoxUpdateGeometry;
let originalTransformerUpdate;
let originalCanvasUpdateAllBones;
//custom bounding box behaviors
let boundingBoxUniqueNameOverride;
let boundingBoxAnimationFrameListener;
let boundingBoxCollisionProperty;
let boundingBoxTagsProperty;
//other cached original behaviors
let originalMolangSyntaxValidatorRun;
let originalGenerateVoxelShapesCondition;
//other custom original behaviors
let patchedMolangSyntaxValidator;
let patchedGenerateVoxelShapesAction;

/**
 * Helper to set width of a bounding box
 * */
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

/**
 * Helper to calculate center of a bounding box
 * */
function getBoundingBoxCenter(box) {
    return new THREE.Vector3(
        (box.from[0] + box.to[0]) / 2,
        (box.from[1] + box.to[1]) / 2,
        (box.from[2] + box.to[2]) / 2
    );
}

/**
 * Manage transformation of an individual bounding box when it comes to anim view
 * Includes positioning and resetting to normal when exiting anim view
 * */
function updateBoundingBoxAnimationTransform(box) {
    if (Format !== format || !box.mesh || !Project.model_3d) return;

    let mesh = box.mesh;
    let center = getBoundingBoxCenter(box);
    if (mesh.parent !== Project.model_3d) Project.model_3d.add(mesh);

    mesh.quaternion.identity();
    mesh.scale.set(1, 1, 1);

    if (Modes.animate && box.parent instanceof Group && box.parent.mesh) {
        let localCenter = center.clone();
        if (box.parent.getTypeBehavior("use_absolute_position")) {
            localCenter.x -= box.parent.origin[0];
            localCenter.y -= box.parent.origin[1];
            localCenter.z -= box.parent.origin[2];
        }

        box.parent.mesh.updateMatrixWorld();
        Project.model_3d.updateMatrixWorld();
        mesh.position.copy(Project.model_3d.worldToLocal(box.parent.mesh.localToWorld(localCenter)));

        let parentScale = new THREE.Vector3();
        let modelScale = new THREE.Vector3();
        box.parent.mesh.getWorldScale(parentScale);
        Project.model_3d.getWorldScale(modelScale);
        mesh.scale.set(
            parentScale.x / (modelScale.x || 1),
            parentScale.y / (modelScale.y || 1),
            parentScale.z / (modelScale.z || 1)
        );
    }
    else {
        mesh.position.copy(center);
    }

    mesh.updateMatrixWorld();
}

/**
 * Basically the above but for all bounding boxes at once
 * */
function updateAllBoundingBoxTransforms() {
    BoundingBox.all.forEach(updateBoundingBoxAnimationTransform);
}

//-----bounding box behavior modification starts here-----
function patchBoundingBoxBehavior() {
    //---if theres cached info, block---
    if (hasOldBBCached) return;

    //---cache original behaviors---
    originalBoundingBoxResize = BoundingBox.prototype.resize;
    originalBoundingBoxExtend = BoundingBox.prototype.extend;
    originalBoundingBoxInit = BoundingBox.prototype.init;
    originalBoundingBoxFunctionElementPanel = BoundingBox.properties.function.inputs.element_panel;
    originalBoundingBoxUpdateTransform = BoundingBox.preview_controller.updateTransform;
    originalBoundingBoxUpdateGeometry = BoundingBox.preview_controller.updateGeometry;

    //---remove original elements---
    delete BoundingBox.properties.function.inputs.element_panel;

    //---define new properties for bounding box editing---
    boundingBoxUniqueNameOverride = BoundingBox.addBehaviorOverride({
        condition: () => Format === format,
        behavior: {unique_name: true}
    });
    boundingBoxCollisionProperty = new Property(BoundingBox, "boolean", "bounding_box_collision", {
        default: true,
        export: false,
        condition: () => Format === format,
        inputs: {
            element_panel: {
                input: {
                    type: "checkbox",
                    label: "Allows Collision",
                    default: true
                },
                onChange(value, boxes) {
                    boxes.forEach(box => {
                        box.bounding_box_collision = !!value;
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
        if (this.bounding_box_collision === undefined) this.bounding_box_collision = data?.collision !== false;
        if (this.mesh) {
            this.preview_controller.updateGeometry(this);
            this.preview_controller.updateTransform(this);
        }
        return result;
    };
    BoundingBox.prototype.init = function() {
        if (Format === format) this.createUniqueName();
        return originalBoundingBoxInit.apply(this, arguments);
    };
    BoundingBox.preview_controller.updateTransform = function(box) {
        if (Format === format && box.mesh) {
            updateBoundingBoxAnimationTransform(box);
            this.updateGeometry(box);
            return;
        }
        let result = originalBoundingBoxUpdateTransform.call(this, box);
        if (Format === format && box.mesh) this.updateGeometry(box);
        return result;
    };
    BoundingBox.preview_controller.updateGeometry = function(box) {
        if (Format !== format || !box.mesh) return originalBoundingBoxUpdateGeometry.call(this, box);

        let center = getBoundingBoxCenter(box).toArray();
        let from = box.from.map((value, axis) => value - center[axis]);
        let to = box.to.map((value, axis) => value - center[axis]);

        to.forEach((value, axis) => {
            if (from[axis] === value) to[axis] += 0.001;
        });

        let vertices = [
            [to[0], to[1], to[2]],
            [to[0], to[1], from[2]],
            [to[0], from[1], to[2]],
            [to[0], from[1], from[2]],
            [from[0], to[1], from[2]],
            [from[0], to[1], to[2]],
            [from[0], from[1], from[2]],
            [from[0], from[1], to[2]],
        ];
        let points = [
            vertices[0], vertices[1],
            vertices[1], vertices[3],
            vertices[2], vertices[3],
            vertices[2], vertices[0],
            vertices[4], vertices[5],
            vertices[5], vertices[7],
            vertices[6], vertices[7],
            vertices[6], vertices[4],
            vertices[0], vertices[5],
            vertices[1], vertices[4],
            vertices[2], vertices[7],
            vertices[3], vertices[6],
        ].map(vertex => new THREE.Vector3().fromArray(vertex));

        box.mesh.geometry.setFromPoints(points);
        box.mesh.geometry.computeBoundingBox();
        box.mesh.geometry.computeBoundingSphere();
        updateBoundingBoxAnimationTransform(box);
    };
    if (window.Transformer && !originalTransformerUpdate) {
        originalTransformerUpdate = Transformer.update;
        Transformer.update = function() {
            let result = originalTransformerUpdate.apply(this, arguments);
            let selectedBoundingBoxes = Format === format
                && Outliner.selected.length
                && Outliner.selected.every(element => element instanceof BoundingBox && element.mesh);
            if (selectedBoundingBoxes) {
                let center = new THREE.Vector3();
                Outliner.selected.forEach(box => {
                    updateBoundingBoxAnimationTransform(box);
                    center.add(box.mesh.getWorldPosition(new THREE.Vector3()));
                });
                center.divideScalar(Outliner.selected.length);
                if (this.parent) this.parent.worldToLocal(center);
                this.position.copy(center);
                this.quaternion.identity();
                this.updateMatrixWorld();
            }
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
    boundingBoxAnimationFrameListener = () => {
        updateAllBoundingBoxTransforms();
    };
    Blockbench.on("display_animation_frame", boundingBoxAnimationFrameListener);
    if (Canvas.updateAllBones && !originalCanvasUpdateAllBones) {
        originalCanvasUpdateAllBones = Canvas.updateAllBones;
        Canvas.updateAllBones = function() {
            let result = originalCanvasUpdateAllBones.apply(this, arguments);
            if (Format === format) {
                updateAllBoundingBoxTransforms();
                setTimeout(() => {
                    if (hasOldBBCached && Format === format) updateAllBoundingBoxTransforms();
                }, 0);
            }
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
    if (originalBoundingBoxInit) {
        BoundingBox.prototype.init = originalBoundingBoxInit;
        originalBoundingBoxInit = null;
    }
    if (originalBoundingBoxFunctionElementPanel) {
        BoundingBox.properties.function.inputs.element_panel = originalBoundingBoxFunctionElementPanel;
        originalBoundingBoxFunctionElementPanel = null;
    }
    if (boundingBoxUniqueNameOverride) {
        boundingBoxUniqueNameOverride.delete();
        boundingBoxUniqueNameOverride = null;
    }
    if (boundingBoxAnimationFrameListener) {
        if (typeof Blockbench.removeListener === "function") {
            Blockbench.removeListener("display_animation_frame", boundingBoxAnimationFrameListener);
        }
        boundingBoxAnimationFrameListener = null;
    }
    let changedElementProperties = false;
    if (boundingBoxCollisionProperty) {
        boundingBoxCollisionProperty.delete();
        boundingBoxCollisionProperty = null;
        changedElementProperties = true;
    }
    if (boundingBoxTagsProperty) {
        boundingBoxTagsProperty.delete();
        boundingBoxTagsProperty = null;
        changedElementProperties = true;
    }
    if (changedElementProperties) Blockbench.dispatchEvent("register_element_type");
    if (originalBoundingBoxUpdateTransform) {
        BoundingBox.preview_controller.updateTransform = originalBoundingBoxUpdateTransform;
        originalBoundingBoxUpdateTransform = null;
    }
    if (originalBoundingBoxUpdateGeometry) {
        BoundingBox.preview_controller.updateGeometry = originalBoundingBoxUpdateGeometry;
        originalBoundingBoxUpdateGeometry = null;
    }
    if (originalCanvasUpdateAllBones) {
        Canvas.updateAllBones = originalCanvasUpdateAllBones;
        originalCanvasUpdateAllBones = null;
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

//---molang validator stuff starts here---
function patchMolangValidator() {
    if (patchedMolangSyntaxValidator) return;

    let molangSyntaxValidator = Validator.checks.find(check => check.id === "molang_syntax");
    if (!molangSyntaxValidator) return;

    originalMolangSyntaxValidatorRun = molangSyntaxValidator.run;
    patchedMolangSyntaxValidator = molangSyntaxValidator;
    molangSyntaxValidator.run = function() {
        let originalFail = this.fail;
        this.fail = function(...problems) {
            let visibleProblems = problems.filter(problem =>
                Format !== format
                || !problem.message.includes(MOLANG_COMPLEX_NO_RETURN_WARNING)
                || !RIFTLIBRARY_MOLANG_CUSTOM_FUNCTION_PATTERN.test(problem.message.match(/Script: `([\s\S]*)`$/)?.[1])
            );
            if (visibleProblems.length) return originalFail.apply(this, visibleProblems);
        };
        try {
            return originalMolangSyntaxValidatorRun.apply(this, arguments);
        }
        finally {
            this.fail = originalFail;
        }
    };
    Validator.validate();
}

function restoreMolangValidator() {
    if (!patchedMolangSyntaxValidator) return;

    patchedMolangSyntaxValidator.run = originalMolangSyntaxValidatorRun;
    patchedMolangSyntaxValidator = null;
    originalMolangSyntaxValidatorRun = null;
    Validator.validate();
}
//---molang validator stuff ends here---

//---hide generate bounding box stuff starts here---
function patchGenerateVoxelShapesAction() {
    if (patchedGenerateVoxelShapesAction) return;

    patchedGenerateVoxelShapesAction = BarItems.generate_voxel_shapes;
    originalGenerateVoxelShapesCondition = patchedGenerateVoxelShapesAction.condition;
    patchedGenerateVoxelShapesAction.condition = () => Format !== format && Condition(originalGenerateVoxelShapesCondition);
    BARS.updateConditions();
}

function restoreGenerateVoxelShapesAction() {
    if (!patchedGenerateVoxelShapesAction) return;

    patchedGenerateVoxelShapesAction.condition = originalGenerateVoxelShapesCondition;
    patchedGenerateVoxelShapesAction = null;
    originalGenerateVoxelShapesCondition = null;
    BARS.updateConditions();
}
//---hide generate bounding box stuff ends here---

//---visual model scale stuff starts here---
function applyRiftLibraryModelScale(scale = Project?.riftlibrary_model_scale || 1, save = true) {
    scale = Math.max(0.01, Math.min(100, parseFloat(scale) || 1));
    if (save) Project.riftlibrary_model_scale = scale;
    Project.model_3d.scale.set(scale, scale, scale);
    Project.model_3d.updateMatrixWorld();
    updateAllBoundingBoxTransforms();
    Preview.all.forEach(preview => preview.render());
}

function patchRiftLibraryModelScalePreview() {
    applyRiftLibraryModelScale(Project.riftlibrary_model_scale || 1, false);
}

function restoreRiftLibraryModelScalePreview() {
    if (Project?.model_3d) Project.model_3d.scale.set(1, 1, 1);
    Preview.all.forEach(preview => preview.render());
}
//---visual model scale stuff ends here---

function parseBoundingBoxes(boxes, parent) {
    if (!boxes) return;
    Object.keys(boxes).forEach(name => {
        let data = boxes[name];
        let width = Math.abs(data.size?.[0] || data.width || 1);
        let height = Math.abs(data.size?.[1] || data.height || 1);
        let origin = data.origin || [0, 0, 0];
        let bounds = data.from && data.to
            ? {from: data.from.slice(), to: data.to.slice()}
            : {
                from: origin.slice(),
                to: [origin[0] + width, origin[1] + height, origin[2] + width]
            };
        let box = new BoundingBox({
            name: name || "bounding_box",
            from: bounds.from,
            to: bounds.to
        }).addTo(parent);
        box.bounding_box_collision = data.collision !== false;
        box.bounding_box_tags = Array.isArray(data.tags) ? data.tags.filter(tag => typeof tag === "string").join(", ") : "";
        box.createUniqueName();
        box.init();
    });
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
                if (Format === format) {
                    patchBoundingBoxBehavior();
                    patchMolangValidator();
                    patchGenerateVoxelShapesAction();
                    patchRiftLibraryModelScalePreview();
                }
                let geometry = model[GEOMETRY_KEY]?.[0];
                if (!geometry) return;

                //normal geometry parse
                Codecs.bedrock.parseGeometry({object: geometry, name: geometry.description?.identifier || ""}, args);

                //special additional parsing for bounding boxes
                let groups = {};
                Group.all.forEach(group => groups[group.name] = group);

                parseBoundingBoxes(geometry[BOUNDING_BOX_KEY], "root");
                geometry.bones?.forEach(bone => {
                    parseBoundingBoxes(bone[BOUNDING_BOX_KEY], groups[bone.name] || "root");
                });
            },
            compile(options = {}) {
                let model = Codecs.bedrock.compile({...options, raw: true});

                //normal geometry parse
                let geometry = model["minecraft:geometry"]?.[0];

                //special additional compilation for bounding boxes
                if (geometry) {
                    let boxes = new Map();
                    BoundingBox.all.forEach(box => {
                        let bone = box.parent instanceof Group ? box.parent.name : "";
                        if (!boxes.has(bone)) boxes.set(bone, {});
                        box.createUniqueName();

                        let compiledBox = {
                            origin: box.from.slice(),
                            size: [Math.max(Math.abs(box.to[0] - box.from[0]), Math.abs(box.to[2] - box.from[2])), Math.abs(box.to[1] - box.from[1])],
                            collision: box.bounding_box_collision !== false
                        };
                        let tags = (Array.isArray(box.bounding_box_tags) ? box.bounding_box_tags : String(box.bounding_box_tags || "").split(","))
                            .map(tag => String(tag).trim())
                            .filter(Boolean);
                        if (tags.length) compiledBox.tags = tags;
                        boxes.get(bone)[box.name] = compiledBox;
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
            description: "Model meant for use in mods that use RiftLibrary, a 1.12.2 mod for the Cleanroom modloader.",
            icon: "bar_chart",
            category: "minecraft",
            target: ["Minecraft: Java Edition", "RiftLibrary", "Cleanroom"],
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
                patchMolangValidator();
                patchGenerateVoxelShapesAction();
                patchRiftLibraryModelScalePreview();
            },
            onDeactivation() {
                restoreBoundingBoxBehavior();
                restoreMolangValidator();
                restoreGenerateVoxelShapesAction();
                restoreRiftLibraryModelScalePreview();
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

        //define change model scale button and action
        changeModelScaleAction = new Action("change_riftlibrary_model_scale", {
            name: "Change Model Scale",
            icon: "zoom_out_map",
            category: "edit",
            condition: () => Format === format,
            click: () => {
                let originalScale = Project.riftlibrary_model_scale || 1;
                let resetting = false;
                let dialog = new Dialog("change_riftlibrary_model_scale", {
                    title: "Change Model Scale",
                    width: 360,
                    darken: false,
                    form: {
                        scale: {
                            label: "Scale",
                            type: "number",
                            value: Project.riftlibrary_model_scale || 1,
                            min: 0.01,
                            max: 100,
                            step: 0.1
                        }
                    },
                    buttons: ["dialog.confirm", "generic.reset", "dialog.cancel"],
                    confirmIndex: 0,
                    cancelIndex: 2,
                    onFormChange(result) {
                        applyRiftLibraryModelScale(result.scale);
                    },
                    onCancel() {
                        if (!resetting) applyRiftLibraryModelScale(originalScale);
                    },
                    onButton(index) {
                        if (index !== 1) return;
                        resetting = true;
                        applyRiftLibraryModelScale(1);
                        dialog.hide();
                    }
                });
                dialog.show();
            }
        });
        MenuBar.addAction(changeModelScaleAction, "tools.#tools");
    },
    onunload() {
        //reset vanilla blockbench behaviors to normal
        restoreBoundingBoxBehavior();
        restoreMolangValidator();
        restoreGenerateVoxelShapesAction();
        restoreRiftLibraryModelScalePreview();

        //delete all le other new elements
        format.delete();
        codec.delete();
        importModel.delete();
        exportModel.delete();
        changeModelScaleAction.delete();
    }
});

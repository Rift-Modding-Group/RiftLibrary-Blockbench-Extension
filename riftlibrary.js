let editHitboxesButton;
let importHitboxesButton;
let exportHitboxesButton;

//this is where the hitboxes are placed in while editing them with this plugin
//or loaded into when importing
/*
hitbox format:
{
    locator: String,
    width: float,
    height: float,
    affectedByAnim: boolean
}
*/
let hitboxes = [];

//this is for storing data involving rendered hitboxes, this is different from the
//hitboxes array as shown above
let renderedHitboxes = [];

//this is for constantly looping the function that renders hitboxes
let renderHitboxLoop;

//this string is for managing selection of hitbox in the edit hitbox form
let oldSelectedHitbox;

//this is the dialog box for editing hitboxes
let hitboxEditDialog = {
	id: 'setup_hitboxes',
	title: 'Setup Hitboxes',
	width: 540,
	form: {
		hitbox: {
            label: 'Hitbox',
            type: 'select', 
            options: {} //initially empty, will be filled up with loaded hitboxes then labels when this dialog is opened
        },
		size: {
            label: 'Size', 
            type: 'vector', 
            value: [1, 1], //this will depend on the selected hitbox, by default its [1, 1]
            dimensions: 2, 
            step: 0.1
        },
        affectedByAnim: {
            label: "Affected by Animation?",
            type: 'checkbox',
            value: true  //this will depend on the selected hitbox, by default its true
        }
    },
	singleButton: true,
	onFormChange({hitbox, size, affectedByAnim}) {
        //change values of the form depending on chosen hitbox
        if (oldSelectedHitbox !== hitbox) {
            for (let x = 0; x < hitboxes.length; x++) {
                if (hitbox === hitboxes[x].locator) {
			        $('.dialog#setup_hitboxes input#size_0').val(hitboxes[x].width);
			        $('.dialog#setup_hitboxes input#size_1').val(hitboxes[x].height);
			        $('.dialog#setup_hitboxes input#affectedByAnim').prop("checked", hitboxes[x].affectedByAnim);
                    break;
                }
            }

            oldSelectedHitbox = hitbox;
        }
        //edit the selected hitbox
        else {
            for (let x = 0; x < hitboxes.length; x++) {
                if (hitbox === hitboxes[x].locator) {
                    hitboxes[x].width = size[0];
                    hitboxes[x].height = size[1];
                    hitboxes[x].affectedByAnim = affectedByAnim;
                    break;
                }
            }
        }
	},
	onOpen() {},
	onConfirm() {
        clearInterval(renderHitboxLoop);
        removeLoadedHitboxes();
		this.hide();
	}
}

Plugin.register('riftlibrary', {
    title: 'RiftLibrary Blockbench Extension',
    author: 'ANightDazingZoroark',
    icon: 'bar_chart',
    description: 'The Blockbench extension for RiftLibrary',
    version: '1.0.0',
    variant: 'both',
    onload() {
        //add edit hitboxes button
        editHitboxesButton = new Action('edit_hitboxes', {
            name: 'Edit Hitboxes',
            description: 'Edit dynamic hitboxes',
            icon: 'bar_chart',
            click: function() {
                //check if the hitbox array is not loaded and if there are no hitbox locators
                //to prevent the rest of this function from loading and show a popup
                if (hitboxes.length <= 0 && !checkIfLocatorHitboxesExist()) {
                    new Dialog({
                        name: 'No Locators nor loaded hitboxes!',
                        lines: ["Make sure to load hitboxes from a valid json file, or add locators whose names start with \"hitbox_\"!"],
                    }).show();
                    return;
                }

                //when only locators are found but a hitboxes file hasnt been imported
                //a popup saying that they haven't imported a hitbox file and that default options will be 
                //given to all the detected hitboxes shows up
                //(commented out because this only shows up when the edit hitboxes dialog closes for some reason)
                /*
                if (hitboxes.length <= 0 && checkIfLocatorHitboxesExist()) {
                    new Dialog({
                        name: 'No hitboxes loaded but locator hitboxes found!',
                        lines: ["Default values will be assigned to these hitboxes. Make sure to import a hitbox file (.json) next time!"],
                    }).show();
                }
                */

                //fill up the dropdown list to add hitbox names
                for (let x = 0; x < hitboxes.length; x++) {
                    let toAssign = hitboxes[x].locator;
                    eval("hitboxEditDialog.form.hitbox.options."+toAssign+" = '"+toAssign+"';");
                }

                //find other locators whose names start with 'hitbox_' and aren't loaded into the
                //hitbox file
                //they are to be put into the hitboxes array too
                for (let x = 0; x < Locator.all.length; x++) {
                    if (checkIfLocatorIsHitbox(Locator.all[x]) && !checkIfLocatorHitboxIsLoaded(Locator.all[x])) {
                        hitboxes.push({
                            locator: Locator.all[x].name,
                            width: 1,
                            height: 1,
                            affectedByAnim: true
                        });

                        let toAssign = Locator.all[x].name;
                        eval("hitboxEditDialog.form.hitbox.options."+toAssign+" = '"+toAssign+"';");
                    }
                }

                //data for the the first hitbox in the hitboxes array will be loaded first
                hitboxEditDialog.form.hitbox.value = hitboxes[0].locator;
                hitboxEditDialog.form.size.value = [hitboxes[0].width, hitboxes[0].height];
                hitboxEditDialog.form.affectedByAnim.value = hitboxes[0].affectedByAnim;

                oldSelectedHitbox = hitboxes[0].locator;

                //show the dialog for editing the hitboxes
                new Dialog(hitboxEditDialog).show();
				$('#blackout').hide(0);

                //constantly render the hitboxes
                renderHitboxLoop = setInterval(() => {
                    renderLoadedHitboxes();
                }, 1);
            }
        });
        MenuBar.addAction(editHitboxesButton, 'filter');

        //add import hitboxes button
        importHitboxesButton = new Action('import_hitboxes', {
            name: 'Import Hitboxes',
            description: 'Import dynamic hitboxes from json file',
            icon: 'bar_chart',
            click: function() {
                //import the hitboxes from the hitbox.json file
                Blockbench.import({
                    type: 'Hitboxes File (.json)',
                    extensions: ['json'],
                    multiple: false
                }, (files) => {
                    const file = files[0]; 
                    const json = JSON.parse(file.content);

                    //put the loaded results in a temp array first
                    let tempHitboxes = json.hitboxes;

                    //if there are two elements that share the same locator name, remove all except one
                    const seen = new Set();
                    tempHitboxes = tempHitboxes.filter(hitbox => {
                        if (seen.has(hitbox.locator)) {
                            return false; // skip duplicates
                        }
                        seen.add(hitbox.locator);
                        return true; // keep first occurrence
                    });

                    //now finally load in the hitboxes
                    hitboxes = tempHitboxes;
				});
            }
        });
        MenuBar.addAction(importHitboxesButton, 'filter');

        //add export hitboxes button
        exportHitboxesButton = new Action('export_hitboxes', {
            name: 'Export Hitboxes',
            description: 'Export dynamic hitboxes to json file',
            icon: 'bar_chart',
            click: function() {
                Blockbench.export({
                    type : 'Hitboxes File (.json)',
                    extensions: ['json'],
                    savetype: 'json',
                    name: Project.geometry_name,
                    content: autoStringify({'hitboxes': hitboxes})
                });
            }
        });
        MenuBar.addAction(exportHitboxesButton, 'filter');
    },
    onunload() {
        hitboxEditDialog.hide();
        editHitboxesButton.delete();
        importHitboxesButton.delete();
        exportHitboxesButton.delete();
        clearInterval(renderHitboxLoop);
        removeLoadedHitboxes();
    }
});

function checkIfLocatorIsHitbox(locatorToCheck) {
    return locatorToCheck.name.length >= 7 && locatorToCheck.name.substring(0, 7) === "hitbox_";
}

function checkIfLocatorHitboxIsLoaded(locatorToCheck) {
    for (let x = 0; x < hitboxes.length; x++) {
        if (hitboxes[x].locator === locatorToCheck.name) return true;
    }
    return false;
}

function checkIfLocatorHitboxesExist() {
    for (let x = 0; x < Locator.all.length; x++) {
        if (checkIfLocatorIsHitbox(Locator.all[x])) return true;
    }
    return false;
}

function getLocatorFromName(locatorName) {
    for (let x = 0; x < Locator.all.length; x++) {
        if (checkIfLocatorIsHitbox(Locator.all[x]) && Locator.all[x].name === locatorName) return Locator.all[x];
    }
    return null;
}

function checkIfLocatorIsSelected(locatorName) {
    for (let x = 0; x < Locator.selected.length; x++) {
        if (Locator.selected[x].name === locatorName) return true;
    }
    return false;
}

//this will be run every time a hitbox gets edited
//or when the edit hitboxes panel gets opened
function renderLoadedHitboxes() {
    //first step is to remove the old hitboxes
    removeLoadedHitboxes();

    //next step is to define the hitboxes
    for (let x = 0; x < hitboxes.length; x++) {
        //if the locator doesn't exist, skip
        if (hitboxes[x] == null) continue;

        //if the locator associated with the hitbox is selected by being clicked on, its color is green
        //else its yellow
        let hitboxColor = checkIfLocatorIsSelected(hitboxes[x].locator) ? 0x6a9955 : 0xffbd2e;

        let visualizedHitbox = new THREE.LineSegments(
			new THREE.BufferGeometry(),
			new THREE.LineBasicMaterial({color: hitboxColor})
		)

        //create bounds for each point for the hitbox to render
        let hitboxMinXPoint = getLocatorFromName(hitboxes[x].locator).getWorldCenter().x - hitboxes[x].width * 8;
        let hitboxMaxXPoint = getLocatorFromName(hitboxes[x].locator).getWorldCenter().x + hitboxes[x].width * 8;
        let hitboxMinYPoint = getLocatorFromName(hitboxes[x].locator).getWorldCenter().y - hitboxes[x].height * 8;
        let hitboxMaxYPoint = getLocatorFromName(hitboxes[x].locator).getWorldCenter().y + hitboxes[x].height * 8;
        let hitboxMinZPoint = getLocatorFromName(hitboxes[x].locator).getWorldCenter().z - hitboxes[x].width * 8;
        let hitboxMaxZPoint = getLocatorFromName(hitboxes[x].locator).getWorldCenter().z + hitboxes[x].width * 8;

        //create position array
		let position_array = [
            //Bottom face
            hitboxMinXPoint, hitboxMinYPoint, hitboxMinZPoint,
            hitboxMaxXPoint, hitboxMinYPoint, hitboxMinZPoint,

            hitboxMaxXPoint, hitboxMinYPoint, hitboxMinZPoint,
            hitboxMaxXPoint, hitboxMinYPoint, hitboxMaxZPoint,

            hitboxMaxXPoint, hitboxMinYPoint, hitboxMaxZPoint,
            hitboxMinXPoint, hitboxMinYPoint, hitboxMaxZPoint,

            hitboxMinXPoint, hitboxMinYPoint, hitboxMaxZPoint,
            hitboxMinXPoint, hitboxMinYPoint, hitboxMinZPoint,

            //Top face
            hitboxMinXPoint, hitboxMaxYPoint, hitboxMinZPoint,
            hitboxMaxXPoint, hitboxMaxYPoint, hitboxMinZPoint,

            hitboxMaxXPoint, hitboxMaxYPoint, hitboxMinZPoint,
            hitboxMaxXPoint, hitboxMaxYPoint, hitboxMaxZPoint,

            hitboxMaxXPoint, hitboxMaxYPoint, hitboxMaxZPoint,
            hitboxMinXPoint, hitboxMaxYPoint, hitboxMaxZPoint,

            hitboxMinXPoint, hitboxMaxYPoint, hitboxMaxZPoint,
            hitboxMinXPoint, hitboxMaxYPoint, hitboxMinZPoint,

            //Vertical edges
            hitboxMinXPoint, hitboxMinYPoint, hitboxMinZPoint,
            hitboxMinXPoint, hitboxMaxYPoint, hitboxMinZPoint,

            hitboxMaxXPoint, hitboxMinYPoint, hitboxMinZPoint,
            hitboxMaxXPoint, hitboxMaxYPoint, hitboxMinZPoint,

            hitboxMaxXPoint, hitboxMinYPoint, hitboxMaxZPoint,
            hitboxMaxXPoint, hitboxMaxYPoint, hitboxMaxZPoint,

            hitboxMinXPoint, hitboxMinYPoint, hitboxMaxZPoint,
            hitboxMinXPoint, hitboxMaxYPoint, hitboxMaxZPoint,
		]
		visualizedHitbox.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position_array), 3));
		visualizedHitbox.geometry.attributes.position.needsUpdate = true;
		
        scene.add(visualizedHitbox);
        renderedHitboxes.push(visualizedHitbox);
    }
}

function removeLoadedHitboxes() {
    for (let x = 0; x < renderedHitboxes.length; x++) {
        scene.remove(renderedHitboxes[x]);
    }
    renderedHitboxes = [];
}
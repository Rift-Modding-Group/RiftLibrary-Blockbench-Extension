let addHitboxButton;
let editHitboxesButton;
let importHitboxesButton;
let exportHitboxesButton;

let hitboxes = [];

Plugin.register('riftlibrary', {
    title: 'RiftLibrary Blockbench Extension',
    author: 'ANightDazingZoroark',
    icon: 'bar_chart',
    description: 'The Blockbench extension for RiftLibrary',
    version: '1.0.0',
    variant: 'both',
    onload() {
        //add hitbox button
        //this creates the associated locator and in a new json file,
        //data associated w that locator that that contains the width and height of the hitbox
        addHitboxButton = new Action('add_hitbox', {
            name: 'Add Hitbox',
            description: 'Add dynamic hitbox',
            icon: 'bar_chart',
            click: function() {
                if (Group.first_selected != null) {
                    //check if theres another locator with the same name as the one to be created
                    //if there is, a number will be added
                    let hitboxNum = checkLocatorCount("hitbox_"+Group.first_selected.name);

                    //create a new locator in the selected group named "hitbox_<name of selected bone>"
                    new Locator({
                        name: 'hitbox_'+Group.first_selected.name+hitboxNum, 
                        parent: Group.first_selected,
                        from: [0, 8, 0]
                    }).init();

                    //in the file to create that contains the other data for the hitbox
                    //add all relevant data
                    hitboxes.push({name: Group.first_selected.name+hitboxNum, width: 1, height: 1, affectedByAnim: true});
                }
                else {
                    //add a popup that basically says "select a group first!"
                }
            }
        });
        MenuBar.addAction(addHitboxButton, 'filter');

        //add edit hitboxes button
        editHitboxesButton = new Action('edit_hitboxes', {
            name: 'Edit Hitboxes',
            description: 'Edit dynamic hitboxes',
            icon: 'bar_chart',
            click: function() {
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
                    hitboxes = json.hitboxes;
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
                console.log(autoStringify({'hitboxes': hitboxes}));
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
        addHitboxButton.delete();
        editHitboxesButton.delete();
        importHitboxesButton.delete();
        exportHitboxesButton.delete();
    }
});

function checkLocatorCount(nameToCheck) {
    let locatorCount = -1;
    for (let x = 0; x < Locator.all.length; x++) {
        if (Locator.all[x].name.includes(nameToCheck)) locatorCount++;
    }
    if (locatorCount == -1) return "";
    else return "_"+locatorCount.toString();
}

function checkIfLocatorExists(nameToCheck) {
    for (let x = 0; x < Locator.all.length; x++) {
        if (Locator.all[x].name === nameToCheck) return true;
    }
    return false;
}

function renderLoadedHitboxes() {

}
let addHitboxButton;
let addImportHitboxesButton;
let addExportHitboxesButton;
let addRiderPositionButton;
let riderPosition;

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
                        parent: Group.first_selected
                    }).init();

                    //in the file to create that contains the other data for the hitbox
                    //add all relevant data
                }
            }
        });
        MenuBar.addAction(addHitboxButton, 'filter');

        //add rider position button
        addRiderPositionButton = new Action('add_rider_position', {
            name: 'Add Rider Position',
            description: 'Add dynamic rider position',
            icon: 'bar_chart',
            click: function() {
                Undo.initEdit({elements: Cube.selected});
                Cube.selected.forEach(cube => {
                    cube.to[1] = cube.from[0] + Math.floor(Math.random()*8);
                });
                Canvas.updateView({
                    elements: Cube.selected,
                    element_aspects: {geometry: true},
                    selection: true
                });
                Undo.finishEdit('add dynamic rider position');
            }
        });
        MenuBar.addAction(addRiderPositionButton, 'filter');
    },
    onunload() {
        addHitboxButton.delete();
        addRiderPositionButton.delete();
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
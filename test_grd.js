const fs = require('fs');
const json = JSON.parse(fs.readFileSync('asterics/nuclear.grd', 'utf8'));
const bundle = { boards: {} };
json.grids.forEach(g => { bundle.boards[g.id] = g; });

const referencedBoards = new Set();
Object.values(bundle.boards).forEach(board => {
    if (board.gridElements) {
        board.gridElements.forEach(el => {
            if (el.actions) {
                el.actions.forEach(action => {
                    if (action.modelName === 'GridActionNavigate' && action.toGridId) {
                        referencedBoards.add(action.toGridId);
                    }
                    else if (action.navType === 'navigateToGrid' && action.toGridId) {
                        referencedBoards.add(action.toGridId);
                    }
                });
            }
        });
    }
});
const unreferenced = Object.keys(bundle.boards).filter(id => !referencedBoards.has(id));
console.log("Unreferenced:", unreferenced);
console.log("Count:", unreferenced.length);
if (unreferenced.length > 0) {
    unreferenced.forEach(id => console.log("Name:", bundle.boards[id].name || bundle.boards[id].label, "ID:", id));
}

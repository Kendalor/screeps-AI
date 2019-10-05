export class RoomPlanner {
    public roomName: string = 'W41N47';

    public run(): void {
        
        if( Memory.plannerData === undefined ){
            Memory.plannerData = {};
            const terrain = new Room.Terrain(this.roomName);
            const visual = new RoomVisual(this.roomName);
            const array = new Array(2500);
            // Fill CostMatrix with default terrain costs for future analysis:
            for(let y = 0; y < 50; y++) {
                for(let x = 0; x < 50; x++) {
                    const tile = terrain.get(x, y);
                    const weight =
                        tile === 0 ? "t" :
                        tile === 1 ? "w" :
                        's' ;
                    array[50*x+y]= weight;
                    visual.text(String(weight), x, y);
                }
            }
            console.log("Saving matrix ...");
            Memory.plannerData = String(array.join(''));
        }
        
    }
}
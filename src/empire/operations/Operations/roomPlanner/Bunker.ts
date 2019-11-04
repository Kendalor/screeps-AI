

export class Bunker {
    public room: Room;
    public rcl: number;
    public buildings: {[id: string]: {pos: Array<{x:number, y:number}> }};
    public dims:  {minX: number, minY:number, maxX: number, maxY: number};
    public sizes: {x: number, y: number};
    public version: string = "1.0.0";
    constructor(room: Room, input: any){
        this.room=room;
        this.rcl=input.rcl;
        this.buildings= input.buildings;
        this.dims = this.getSize();
        console.log("Dims: minX: " + this.dims.minX +" maxX:"+ this.dims.maxX +" minY: " + this.dims.minY + " maxY:" +  this.dims.maxY);
        this.sizes = {x: Math.abs(this.dims.maxX-this.dims.minX), y: Math.abs(this.dims.maxY-this.dims.minY)}
        this.convertToRelative();
    }
    // public const data = {"name":"textExport","shard":"shard0","rcl":"8","buildings":{"road":{"pos":[{"x":16,"y":12},{"x":17,"y":12},{"x":18,"y":12},{"x":19,"y":12},{"x":20,"y":12},{"x":21,"y":12},{"x":22,"y":12},{"x":23,"y":12},{"x":24,"y":12},{"x":25,"y":12},{"x":26,"y":12},{"x":27,"y":12},{"x":28,"y":12},{"x":16,"y":13},{"x":19,"y":13},{"x":24,"y":13},{"x":25,"y":13},{"x":28,"y":13},{"x":16,"y":14},{"x":18,"y":14},{"x":23,"y":14},{"x":26,"y":14},{"x":28,"y":14},{"x":16,"y":15},{"x":17,"y":15},{"x":22,"y":15},{"x":27,"y":15},{"x":28,"y":15},{"x":16,"y":16},{"x":17,"y":16},{"x":21,"y":16},{"x":23,"y":16},{"x":28,"y":16},{"x":16,"y":17},{"x":18,"y":17},{"x":20,"y":17},{"x":24,"y":17},{"x":28,"y":17},{"x":16,"y":18},{"x":19,"y":18},{"x":25,"y":18},{"x":28,"y":18},{"x":16,"y":19},{"x":20,"y":19},{"x":24,"y":19},{"x":26,"y":19},{"x":28,"y":19},{"x":16,"y":20},{"x":21,"y":20},{"x":23,"y":20},{"x":27,"y":20},{"x":16,"y":21},{"x":17,"y":21},{"x":22,"y":21},{"x":27,"y":21},{"x":16,"y":22},{"x":18,"y":22},{"x":21,"y":22},{"x":26,"y":22},{"x":16,"y":23},{"x":19,"y":23},{"x":20,"y":23},{"x":25,"y":23},{"x":16,"y":24},{"x":17,"y":24},{"x":18,"y":24},{"x":19,"y":24},{"x":20,"y":24},{"x":21,"y":24},{"x":22,"y":24},{"x":23,"y":24},{"x":24,"y":24},{"x":48,"y":27},{"x":48,"y":28},{"x":49,"y":28},{"x":49,"y":29}]},"extension":{"pos":[{"x":17,"y":13},{"x":18,"y":13},{"x":20,"y":13},{"x":21,"y":13},{"x":22,"y":13},{"x":23,"y":13},{"x":26,"y":13},{"x":27,"y":13},{"x":17,"y":14},{"x":19,"y":14},{"x":20,"y":14},{"x":21,"y":14},{"x":22,"y":14},{"x":24,"y":14},{"x":25,"y":14},{"x":27,"y":14},{"x":18,"y":15},{"x":19,"y":15},{"x":20,"y":15},{"x":21,"y":15},{"x":23,"y":15},{"x":24,"y":15},{"x":25,"y":15},{"x":26,"y":15},{"x":18,"y":16},{"x":19,"y":16},{"x":20,"y":16},{"x":24,"y":16},{"x":25,"y":16},{"x":26,"y":16},{"x":27,"y":16},{"x":17,"y":17},{"x":19,"y":17},{"x":25,"y":17},{"x":26,"y":17},{"x":27,"y":17},{"x":17,"y":18},{"x":18,"y":18},{"x":26,"y":18},{"x":27,"y":18},{"x":17,"y":19},{"x":18,"y":19},{"x":19,"y":19},{"x":27,"y":19},{"x":17,"y":20},{"x":18,"y":20},{"x":19,"y":20},{"x":20,"y":20},{"x":18,"y":21},{"x":19,"y":21},{"x":20,"y":21},{"x":21,"y":21},{"x":17,"y":22},{"x":19,"y":22},{"x":20,"y":22},{"x":22,"y":22},{"x":17,"y":23},{"x":18,"y":23},{"x":21,"y":23},{"x":22,"y":23}]},"tower":{"pos":[{"x":22,"y":16},{"x":20,"y":18},{"x":24,"y":18},{"x":22,"y":19},{"x":23,"y":19},{"x":22,"y":20}]},"spawn":{"pos":[{"x":21,"y":17},{"x":23,"y":17},{"x":21,"y":19}]},"link":{"pos":[{"x":22,"y":17}]},"terminal":{"pos":[{"x":21,"y":18}]},"storage":{"pos":[{"x":23,"y":18}]},"lab":{"pos":[{"x":25,"y":19},{"x":24,"y":20},{"x":25,"y":20},{"x":26,"y":20},{"x":24,"y":21},{"x":25,"y":21},{"x":26,"y":21},{"x":24,"y":22},{"x":25,"y":22},{"x":24,"y":23}]},"observer":{"pos":[{"x":23,"y":21}]},"powerSpawn":{"pos":[{"x":23,"y":22}]},"nuker":{"pos":[{"x":23,"y":23}]}}};


    public getSize(): {minX: number, minY:number, maxX: number, maxY: number}{
        let minX=50;
        let maxX=0;
        let minY=50;
        let maxY=0;
        for(const key of Object.keys(this.buildings)){
            // console.log( "Key: " + key+ " " + JSON.stringify(this.buildings[key]));
            for(const pos of this.buildings[key].pos){
                if(minX > pos.x){
                    minX=pos.x;
                }
                if(maxX < pos.x){
                    maxX=pos.x
                }
                if(minY > pos.y){
                    minY=pos.y;
                }
                if(maxY < pos.x){
                    maxY=pos.y
                }
                
            }
        }
        return {minX, minY, maxX, maxY};
    }


    public convertToRelative(): void {
        const dims = this.getSize();
        const lengthY = Math.abs(dims.maxY-dims.minY)+1;
        const lengthX = Math.abs(dims.maxX-dims.minX)+1;
        for(const key of Object.keys(this.buildings)){
            for(const pos of this.buildings[key].pos) {
                pos.x = pos.x-dims.maxX + Math.ceil(lengthX/2);
                pos.y = pos.y-dims.maxY + Math.ceil(lengthY/2);
            }
        }
    }

    public run(): void {
        this.visualize();
        if(Memory.temp == null){
            Memory.temp = {};
        }
        if(Memory.temp != null){
            if(Memory.temp[this.rcl] == null){
                this.convertToRelative();
                Memory.temp[this.rcl]=String(this.buildings);
            }
        }
        if(Memory.temp.terrain == null){
            Memory.temp.terrain = this.doesFitBunker(this.room);
        }
        if(Memory.temp.distanceTransform == null){
            Memory.temp.distanceTransform = this.doTransform(this.room);
        }
    }

    public doTransform(room: Room): Array<{x: number, y: number}>{
        const roomName = room.name;
        const out = new Array<{x: number, y: number}>();
        let time = (new Date()).getMilliseconds();
        let cpu = Game.cpu.getUsed();
        const dt = Bunker.distanceTransform(Bunker.walkablePixelsForRoom(roomName)); // a bare Uint8Array
        const cm = new PathFinder.CostMatrix();
        for(const i in dt){
            if(dt[i] >= 6) {
                out.push({x: Math.floor(Number(i)/50), y: Number(i)%50})
            }
        }
        // Find nearest to Controller
        // const sources = room.find(FIND_SOURCES);

        // const goal = out.sort( (eA,eB) => 
        // Math.abs(
        //     (room.controller!.pos.getRangeTo(eA.x,eA.y) + sources[0].pos.getRangeTo(eA.x,eA.y) + sources[1].pos.getRangeTo(eA.x,eA.y) )
        //  - (room.controller!.pos.getRangeTo(eB.x,eB.y) + sources[0].pos.getRangeTo(eB.x,eB.y) + sources[1].pos.getRangeTo(eB.x,eB.y) ))
        //  ).pop();
        // const temp = new Array<{x: number, y: number}>();
        // if(goal != null){
        //     temp.push(goal);
        // }
        
        

        time = (new Date()).getMilliseconds() - time;
        cpu = Game.cpu.getUsed()-cpu;

        console.log(`dt for ${roomName} took ${time}ms  ${cpu}cpu `);
        return out;
    }

    public testRoom(room: Room): boolean {
        if(room.controller != null){
            const numSources = room.find(FIND_SOURCES).length;
            if(numSources === 2) {
                return this.doesFitBunker(room).length > 0;
            }
        }
        return false;
    }

    public doesFitBunker(room: Room): Array<{x: number, y: number}> {
        const out = new Array<{x: number, y: number}>();
        for(let x=Math.ceil(this.sizes.x/2); x< Math.ceil(50-(this.sizes.x/2)); x++){
            for(let y=Math.ceil(this.sizes.y/2); y < Math.ceil(50-(this.sizes.y/2)); y++){
                room.visual.circle(x,y);
                const walls = room.lookForAtArea(LOOK_TERRAIN, y-Math.ceil(this.sizes.y/2),x-Math.ceil(this.sizes.x/2),y+Math.ceil(this.sizes.y/2),x+Math.ceil(this.sizes.x/2),true).filter(
                    entry => entry.terrain === 'wall'
                ).length >0;
                if( !walls){
                    console.log("Cube found");
                    out.push({x,y});
                }
            }
        }
        return out;

    }




    public visualize(): void {
        const vis = this.room.visual;
        if(Memory.temp.distanceTransform != null){
            for(const c of Memory.temp.distanceTransform){
                vis.circle(c.x,c.y);
            }
        }

    }

    public static distanceTransform(array: Uint8Array, oob = -1): Uint8Array {
        // Variables to represent the 3x3 neighborhood of a pixel.
        let A;
        let B;
        let C;
        let D;
        let E;
        let F;
        let G;
        let H;
        let I;
    ​
        
        let value;
        for (let n = 0; n < 2500; n++) {
            if (array[n] !== 0) {
                A = array[n-51]; B = array[n- 1];
                D = array[n-50];
                G = array[n-49];
                if (   n%50  ===  0) { A = oob; B = oob; }
                if (   n%50  === 49) { G = oob; }
                // tslint:disable-next-line:no-bitwise
                if (~~(n/50) ===  0) { A = oob; D = oob; G = oob; }
    ​
                array[n]=(Math.min(A, B, D, G, 254) + 1);
            }
        }
    ​
        for (let n = 2499; n >=0; n--) {
            ;                                 C = array[n+49];
            ;                E = array[n   ]; F = array[n+50];
            ;                H = array[n+ 1]; I = array[n+51];
            if (   n%50  ===  0) { C = oob; }
            if (   n%50  === 49) { H = oob; I = oob; }
            // tslint:disable-next-line:no-bitwise
            if (~~(n/50) === 49) { C = oob; F = oob; I = oob; }
    ​
            value = Math.min(C + 1, E, F + 1, H + 1, I + 1);
            array[n]=(value);
        }
    ​
        return array;
    }
}
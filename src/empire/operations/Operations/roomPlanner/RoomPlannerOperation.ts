import { OperationsManager } from "empire/OperationsManager";
import { FlagOperation } from "../FlagOperation";
import { OperationMemory } from "../OperationMemory";

export class RoomPlannerOperation extends FlagOperation {
    constructor(manager: OperationsManager, entry: OperationMemory){
        super(manager,entry);
    }

    public run(): void {
        super.run();
        console.log("RoomPlanner:");
        if(Memory.rooms[this.flag.pos.roomName] == null){
            Memory.rooms[this.flag.pos.roomName] = {}
        }
        if(Memory.rooms[this.flag.pos.roomName].base == null){
            Memory.rooms[this.flag.pos.roomName].base = {}
        }
        


        if(Memory.rooms[this.flag.pos.roomName].temp == null){
            Memory.rooms[this.flag.pos.roomName].temp = {};
        }
        if(Memory.rooms[this.flag.pos.roomName].temp.distanceTransform == null){
            Memory.rooms[this.flag.pos.roomName].temp.distanceTransform = this.doTransform(this.flag.pos.roomName);
        }

        this.visualize()
        if(this.lastRun === true){
            delete Memory.rooms[this.flag.pos.roomName].temp;
        }
        
    }

    public doTransform(roomName: string): Array<{x: number, y: number}>{
        const out = new Array<{x: number, y: number}>();
        let time = (new Date()).getMilliseconds();
        let cpu = Game.cpu.getUsed();
        const dt = RoomPlannerOperation.distanceTransform(RoomPlannerOperation.walkablePixelsForRoom(roomName)); // a bare Uint8Array
        const cm = new PathFinder.CostMatrix();
        for(const i in dt){
            if(dt[i] >= 6) {
                out.push({x: Math.floor(Number(i)/50), y: Number(i)%50})
            }
        }
        
        

        time = (new Date()).getMilliseconds() - time;
        cpu = Game.cpu.getUsed()-cpu;

        console.log(`dt for ${roomName} took ${time}ms  ${cpu}cpu `);
        return out;
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

    public static walkablePixelsForRoom(roomName: string): Uint8Array {
        const array = new Uint8Array(2500);
        for (let x = 0; x < 50; ++x) {
            for (let y = 0; y < 50; ++y) {
                if (Game.map.getTerrainAt(x, y, roomName) !== 'wall') {
                    array[x*50+y] = 1;
                } else {
                    array[x*50+y] = 0;
                }
            }
        }
        return array;
    }

    public visualize(): void {
        if(Game.rooms[this.flag.pos.roomName] != null){
            const room = Game.rooms[this.flag.pos.roomName];
            const vis = room.visual;
            if(Memory.rooms[this.flag.pos.roomName].temp.distanceTransform != null){
                console.log("Drawing RoomVisual");
                for(const c of Memory.rooms[this.flag.pos.roomName].temp.distanceTransform){
                    console.log("Drawing Circle");
                    vis.circle(c.x,c.y);
                }
            }
        }


    }
}
import { OperationsManager } from "empire/OperationsManager";
import { FlagOperation } from "../FlagOperation";
import { OperationMemory } from "../OperationMemory";
import { Base } from "./layouts/Base";





interface BuildEntry {
    x: number,
    y: number,
    type: BuildableStructureConstant
}


export class RoomPlannerOperation extends FlagOperation {
    private basePlan = new Base();

    public anchor: {x: number, y:number} | null;
    public inProgress: BuildEntry[] = new Array<BuildEntry>();
    public leftToBuild = new Array<BuildEntry>();
    public alreadyBuild: BuildEntry[]= new Array<BuildEntry>();
    public neededToRaze: BuildEntry[] = new Array<BuildEntry>();
    public blocking: BuildEntry[] = new Array<BuildEntry>();
    public wrongPosition: BuildEntry[] = new Array<BuildEntry>();
    private MAX_CONSTRUCTION_SITES = 1;
    private BUNKER_RADIUS = 5;


    constructor(name: string, manager: OperationsManager, entry: OperationMemory){
        super(name, manager, entry);
        this.initMemory();

        if(this.data.leftToBuild != null){
            if(this.data.leftToBuild.length > 0){
                this.leftToBuild = this.data.leftToBuild;
            }
        }

        if(this.data.inProgress != null){
            if(this.data.inProgress.length > 0){
                this.inProgress = this.data.inProgress;
            }
        }

        this.anchor = Memory.rooms[this.flag.pos.roomName].base.anchor as {x: number, y:number};

    }
    private initMemory():void {
        if(Memory.rooms[this.flag.pos.roomName].base == null){
            Memory.rooms[this.flag.pos.roomName].base = {};
       }
       if(Memory.rooms[this.flag.pos.roomName].base.bunker == null) {
           Memory.rooms[this.flag.pos.roomName].base.bunker = {};
       }
       if(Memory.rooms[this.flag.pos.roomName].base.bunker !== false){
           if(Memory.rooms[this.flag.pos.roomName].base.anchor == null){
            if(Memory.rooms[this.flag.pos.roomName].temp == null ){
                Memory.rooms[this.flag.pos.roomName].temp = {};
               }
           } 
       }
    }

    private writeToMemory(): void {
        this.data.inProgress = this.inProgress;
        this.data.leftToBuild = this.leftToBuild;
    }

    public run(): void {
        super.run();
        this.watchForFlags();
        console.log("RoomPlanner:");
        // this.updateProgress(this.basePlan.buildings);
        if(Memory.rooms[this.flag.pos.roomName].base.bunker !== false){
            if(this.anchor == null) {
                if(Memory.rooms[this.flag.pos.roomName].temp.distanceTransform == null) {
                    Memory.rooms[this.flag.pos.roomName].temp.distanceTransform = this.doTransform(this.flag.pos.roomName);
                } else {
                    if(Memory.rooms[this.flag.pos.roomName].temp.distanceTransform.length > 0) {
                        Memory.rooms[this.flag.pos.roomName].base.anchor = this.getMostCenterPos(Memory.rooms[this.flag.pos.roomName].temp.distanceTransform);
                        Memory.rooms[this.flag.pos.roomName].base.bunker = true;
                    } else {
                        Memory.rooms[this.flag.pos.roomName].base.bunker = false;
                        this.lastRun = true;
                    }
                }
            } else {
                console.log("Anchor not null");
                
                this.validateInProgressList();

                if(this.inProgress.length === 0) {
                    console.log("Nothing in Progress");
                    console.log(this.leftToBuild.length);
                    if(this.leftToBuild.length > 0){ 
                        this.processLeftToBuild();
                    } else {
                        this.updateProgress(this.basePlan.buildings);
                        if(this.leftToBuild.length > 0){
                            this.processLeftToBuild();
                        } else if(this.blocking.length > 0) {
                            this.removeBlocking();
                        } else if (this.wrongPosition.length > 0){
                            this.removeWrongPosition();
                        } else {
                            this.pause = 1000;
                        }
                    }
                }
                this.drawBase();
            }
        } else {
            this.lastRun = true;
        }
        this.writeToMemory();
    }

    private removeBlocking(): void {
        const entry = this.blocking.pop();
        if(entry != null){
            this.removeBuildEntryFromRooom(entry);
        }
    }

    private removeWrongPosition(): void {
        const entry = this.wrongPosition.pop();
        if(entry != null){
            this.removeBuildEntryFromRooom(entry);
        }
    }

    private removeBuildEntryFromRooom(entry: BuildEntry): void{
        if(this.flag.room != null) {
            const structures = this.flag.room.lookForAt(LOOK_STRUCTURES, entry.x, entry.y).filter( e => e.structureType === entry.type );
            if( structures.length > 0){
                for( const structure of structures){
                    structure.destroy();
                }
            } 
        }
    }

    private processLeftToBuild(): void {
        let counter =0;
        const tempList = new Array<BuildEntry>();
        for(const entry of this.leftToBuild){
            if(this.inProgress.length < this.MAX_CONSTRUCTION_SITES){
                const newPos = this.transformPos(entry);
                if(this.flag.room != null){
                    const code = this.flag.room.createConstructionSite(newPos.x,newPos.y,entry.type);
                    if(code === OK){
                        counter += 1;
                        this.inProgress.push(entry);
                    }
                }
            } else {
                tempList.push(entry);
            }
        }
        this.leftToBuild=tempList;
    }

    private validateInProgressList(): void {
        const tempList = new Array<BuildEntry>();
        console.log("Validate inProgress IN: " + JSON.stringify(this.inProgress));
        for(const entry of this.inProgress){
            if(!this.isBuildEntryBuild(entry) && this.isBuildEntryConstructing(entry)){
                tempList.push(entry);
            }
        }

        this.inProgress=tempList;
        console.log("Validate inProgress OUT: " + JSON.stringify(this.inProgress));
    }
    private isBuildEntryBuild(entry: BuildEntry): boolean {
        const newPos = this.transformPos(entry);
        if(this.flag.room != null){
            const lookResult = this.flag.room.lookForAt(LOOK_STRUCTURES, newPos.x, newPos.y);
            if(lookResult.length > 0){
                for(const r of lookResult){
                    if(r.structureType === entry.type){
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private isBuildEntryConstructing(entry: BuildEntry): boolean {
        const newPos = this.transformPos(entry);
        if(this.flag.room != null){
            const lookResult = this.flag.room.lookForAt(LOOK_CONSTRUCTION_SITES, newPos.x, newPos.y);
            if(lookResult.length > 0){
                for(const r of lookResult){
                    if(r.structureType === entry.type){
                        return true;
                    }
                }
            }
        }
        return false;

    }

    private drawBase(): void {
        const anchor = Memory.rooms[this.flag.pos.roomName].base.anchor;
        console.log("drawing" + JSON.stringify(anchor));
        if(this.flag.room != null){
            console.log("Drawing");
            for(const entry of this.leftToBuild){
                // console.log("Drawing entry. " + JSON.stringify(entry));
                const transformPos = this.transformPos(entry);
                this.flag.room.visual.structure(transformPos.x, transformPos.y, entry.type, {opacity: 0.3});
            }
        }
    }

    private transformPos(inPos: {x:number, y:number}): {x: number, y:number}{
        if(this.anchor != null){
            return {x: inPos.x+this.anchor.x , y: inPos.y + this.anchor.y  };
        } else {
            return inPos;
        }

    }


    private updateProgress(completeList: Array<{x: number, y: number, type: BuildableStructureConstant}> ): void{
        // console.log("Buildig List Test total length: " + completeList.length);
        this.alreadyBuild = new Array<BuildEntry>();
        this.leftToBuild = new Array<BuildEntry>();
        this.neededToRaze = new Array<BuildEntry>();
        this.blocking = new Array<BuildEntry>();
        this.wrongPosition = new Array<BuildEntry>();
        if(this.flag.room != null){
            const room: Room = this.flag.room;
            if(room.controller != null){
                const lvl: number = room.controller.level;
                const structures: Structure[] = room.find(FIND_STRUCTURES);
                for( const type  of Object.keys(CONTROLLER_STRUCTURES)){
                    // console.log("Type: " + type);
                    const leftToBuild = new Array<BuildEntry>();
                    const alreadyBuild: BuildEntry[]= new Array<BuildEntry>();
                    const neededToRaze: BuildEntry[] = new Array<BuildEntry>();
                    // Buildings Blocking the Construction of a Bunker Structure
                    const blocking: BuildEntry[] = new Array<BuildEntry>();
                    const wrongPosition: BuildEntry[] = new Array<BuildEntry>();
                    const max = CONTROLLER_STRUCTURES[type as BuildableStructureConstant][lvl];
                    const buildStructures = structures.filter( str => str.structureType === type);
                    const temp = completeList.filter( entry => entry.type === type).slice(0,max);
                    // There Buildings To build for this Type and RCL allows to
                    if( max > 0 && temp.length > 0){
                        // Go through  MAX number of Entries for the given type
                        for( const entry of temp.slice(0,max)){
                            const pos = this.transformPos(entry);
                            const lookResult = room.lookForAt(LOOK_STRUCTURES, pos.x,pos.y);
                            // Found  a Structure at a given POS 
                            if(lookResult.length > 0){
                                // Go through all structures at the position
                                for(const posEntry of lookResult){
                                    if( posEntry.structureType === entry.type){
                                        alreadyBuild.push(entry); // If a structure of the type at the pos is found => entry is already built
                                    } else if( posEntry.structureType !== entry.type){
                                        // If a structure is found not of the type, there is a structure Blocking at this Position
                                        blocking.push({x: posEntry.pos.x, y: posEntry.pos.y, type: posEntry.structureType as BuildableStructureConstant}); 
                                    }
                                }
                            } else {
                                // Found no Structures at the given Postion => Free to add entry to LeftToBuild
                                if(leftToBuild.length < max-buildStructures.length){
                                    leftToBuild.push(entry);
                                }
                            }
                        }
                        // Not all Structures are Currenty Build
                        if(alreadyBuild.length !== temp.length ){
                            // onsole.log("Already Build does not Equal the desired Amount");
                            // Found buildings of the given type are not all in the correct Postion
                            if( buildStructures.length !== alreadyBuild.length){
                                // console.log("Found Structures  are not euqal to correcty Placed");
                                if((temp.length - alreadyBuild.length) > (max - buildStructures.length) ){
                                    // console.log("Number of not corretly placed buildings is larger than number of not placed Buildings");
                                    // All Buildings Are in Wrong Position
                                    if(alreadyBuild.length === 0){
                                        // console.log("Correctly placed is equal to zero => therefore all found buildings are wrongly placed");
                                        for( const building of buildStructures){
                                            wrongPosition.push({x: building.pos.x, y: building.pos.y, type: building.structureType as BuildableStructureConstant});
                                        }
                                    } else {
                                        // Expensive Filtering Define which BUildings are in Wrong Positions
                                        // console.log("Finding wrongly placed Structures");
                                        for( const building of buildStructures){
                                            const bPos = {x: building.pos.x, y: building.pos.y, type: building.structureType as BuildableStructureConstant};
                                            // console.log(" is Structure at x: " + bPos.x +" y: "+ bPos.y + " correctly Placed ?");
                                            let found = false;
                                            for( const alreadyBuildEntry of alreadyBuild){
                                                const tempPos = this.transformPos(alreadyBuildEntry);
                                                if(!found && tempPos.x === bPos.x && tempPos.y === bPos.y && alreadyBuildEntry.type === bPos.type){
                                                    found = true;
                                                }
                                            }
                                            if(!found){
                                                // console.log("No, added to wrongPositionlist");
                                                wrongPosition.push(bPos);
                                            }
                                        }
                                    }
                                } 
                            } 
                        }
                    }
                    this.alreadyBuild = this.alreadyBuild.concat(alreadyBuild);
                    this.leftToBuild = this.leftToBuild.concat(leftToBuild);
                    this.neededToRaze = this.neededToRaze.concat(neededToRaze);
                    this.blocking = this.blocking.concat(blocking);
                    this.wrongPosition = this.wrongPosition.concat(wrongPosition);
                }

            }

        }
        console.log("Updating RoomPlanner Status: ");
        console.log( " already Build Length: " + this.alreadyBuild.length);
        console.log(" left2Build length: " + this.leftToBuild.length);
        console.log(" neeed to Raze: " + this.neededToRaze.length);
        console.log(" Blocking length: : " + this.blocking.length);
        console.log(" wrong Position length : " + this.wrongPosition.length);
        console.log("Sum Check: " + completeList.length +  " VS " + (this.alreadyBuild.length + this.leftToBuild.length +this.neededToRaze.length + this.blocking.length + this.wrongPosition.length))

    }

    private watchForFlags(): void {
        for(const f of Object.keys(Game.flags)){
            const flag = Game.flags[f];
            if(flag.color === COLOR_GREY){
                switch(flag.secondaryColor){
                    case COLOR_WHITE:
                        Memory.rooms[this.flag.pos.roomName].base.anchor = {x: flag.pos.x, y: flag.pos.y};
                        flag.remove();
                        break;
                    case COLOR_YELLOW:
                        if(this.flag.memory.seen == null) {
                            this.flag.memory.seen = true;
                            if(this.data.sources == null){
                                this.data.sources = [];
                            }
                        }
                }
            }
        }
    }


    public doTransform(roomName: string): Array<{x: number, y: number}>{
        const out = new Array<{x: number, y: number}>();
        let time = (new Date()).getMilliseconds();
        let cpu = Game.cpu.getUsed();
        const dt = RoomPlannerOperation.distanceTransform(RoomPlannerOperation.walkablePixelsForRoom(roomName)); // a bare Uint8Array
        const cm = new PathFinder.CostMatrix();
        for(const i in dt){
            if(dt[i] > this.BUNKER_RADIUS) {
                out.push({x: Math.floor(Number(i)/50), y: Number(i)%50})
            }
        }
        

        time = (new Date()).getMilliseconds() - time;
        cpu = Game.cpu.getUsed()-cpu;

        console.log(`dt for ${roomName} took ${time}ms  ${cpu}cpu `);
        return out;
    }

    public getMostCenterPos(input: Array<{x: number, y: number}>): {x: number, y: number} | null{
        const center ={x:24.5 , y: 24.5}; 
        const sorted = input.sort( (a,b) => this.euclidianDist(center,a) - this.euclidianDist(center,b));
        for( const element of sorted){
            console.log(" Positon x: " + element.x + ", y: " + element.y + " with Distance: " + this.euclidianDist(center, element));
        }
        const out = sorted[0];
        if( out != null){
            return out;
        }
        return null;
    }
    private euclidianDist(a: {x: number, y:number}, b: {x:number, y:number}): number {
        return Math.sqrt( Math.pow( a.x -b.x,2 ) + Math.pow(a.y - b.y, 2));
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
        if(this.flag.room != null){
            if(Memory.rooms[this.flag.pos.roomName].temp.distanceTransform != null){
                console.log("Drawing Circles over " + Memory.rooms[this.flag.pos.roomName].temp.distanceTransform.length + " positions");
                for(const c of Memory.rooms[this.flag.pos.roomName].temp.distanceTransform){
                    this.flag.room.visual.circle(c.x,c.y);
                }
            }
        }
    }
}
import { OperationsManager } from "empire/OperationsManager";
import { RoomMemoryUtil } from "utils/RoomMemoryUtil";
import { InitialRoomOperation } from "../InitialBuildUpPhase/InitRoomOperation";
import { RoomOperation, RoomOperationProto } from "../RoomOperation";
import { Base } from "./layouts/Base";

const BUILDING_PRIORITY: { [key: string]: number} = {
    "spawn": 100,
    "tower": 90,
    "extension": 80,
    "road": -1
};


export class RoomPlannerOperation extends RoomOperation {
    private basePlan = new Base();
    public anchor: {x: number, y:number} | null;
    public inProgress: BuildEntry[] = new Array<BuildEntry>();
    public leftToBuild = new Array<BuildEntry>();
    public alreadyBuild: BuildEntry[]= new Array<BuildEntry>();
    public blocking: BuildEntry[] = new Array<BuildEntry>();
    private MAX_CONSTRUCTION_SITES = 1;
    private BUNKER_RADIUS = 6;
    private DEFAULT_PAUSE_TIME = 50;
    private buildingCostMatrix: null | CostMatrix = null;


    constructor(name: string, manager: OperationsManager, entry: RoomOperationProto){
        super(name, manager, entry);
        this.initMemory();
        this.type = OPERATION.ROOMPLANNER;
        this.priority=50;

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
        if(RoomMemoryUtil.isBaseSet(this.room.name)){
            this.anchor = Memory.rooms[this.data.roomName]!.base!.anchor as {x: number, y:number};
        } else {
            this.anchor = null;
        }
    }

    private initMemory():void {
        if(!RoomMemoryUtil.isBaseSet(this.room.name)){
            RoomMemoryUtil.setRoomMemory(this.room);
        }
    }

    private writeToMemory(): void {
        this.data.inProgress = this.inProgress;
        this.data.leftToBuild = this.leftToBuild;
    }

    public run(): void {
        super.run();
        if(Game.cpu.bucket < 3000){
            return;
        }
        //console.log("Shard: " + Game.shard.name + " Room: " + this.room.name + " RoomPlanner");
        if( !Memory.rooms[this.data.roomName] || !Memory.rooms[this.data.roomName].base) {
            return;
        }
        if( Memory.rooms[this.data.roomName].base!.bunker === false){
            return
        }
        if(this.anchor === null) {
            return;
        }

        this.validateInProgressList();

        if(this.inProgress.length !== 0) {
            this.pause = this.DEFAULT_PAUSE_TIME;
            //console.log("This in Progress has size: " + this.inProgress.length);
            return;
        }
        if(this.leftToBuild.length > 0){ 
            if(Game.time % 3000 === 0){
                this.updateProgress(this.generateCompleteList());
            }
            this.processLeftToBuild();
        } else {
            this.razeEverythingNotOnList();
            this.updateProgress(this.generateCompleteList());
            if(this.leftToBuild.length > 0){
                this.processLeftToBuild();
            } else if(this.blocking.length > 0) {
                this.removeBlocking();
            } else {
                this.pause = this.DEFAULT_PAUSE_TIME;
            }
        }
        // TODO FIX
        //this.drawBase();


        this.writeToMemory();
    }

    private removeBlocking(): void {
        const entry = this.blocking.pop();
        if(entry != null){
            this.removeBuildEntryFromRooom(entry);
        }
    }


    private generateCompleteList(): BuildEntry[] {
        const out: Set<BuildEntry> = new Set<BuildEntry>();
        for( const e of this.basePlan.buildings){
            const newPos= this.transformPos(e);
            out.add({x: newPos.x, y: newPos.y, type: e.type});
        }
        if(this.parent != null){
            const base =this.manager.getEntryByName<InitialRoomOperation>(this.parent);
            
            if(base != null && base.type === OPERATION.BASE){
                const baseList = base.getBuildingList();
                for(const i of baseList){
                    if(!out.has(i)){

                        out.add(i);
                    }
                }
            }
        }


        return Array.from(out);
    }

    private removeBuildEntryFromRooom(entry: BuildEntry): void{
        if(this.room != null) {
            const structures = this.room.lookForAt(LOOK_STRUCTURES, entry.x, entry.y).filter( e => e.structureType === entry.type );
            if( structures.length > 0){
                for( const structure of structures){
                    structure.destroy();
                }
            } 
        }
    }
    private getBuildingPriority(type: string): number {
        return BUILDING_PRIORITY[type] ? BUILDING_PRIORITY[type] : 0;
    }

    private processLeftToBuild(): void {
        let counter =0;
        const tempList = new Array<BuildEntry>();
        this.leftToBuild.sort( (a,b) => this.getBuildingPriority(a.type) - this.getBuildingPriority(b.type) ).reverse();
        for(const entry of this.leftToBuild){
            console.log(this.name)
            if(this.inProgress.length < this.MAX_CONSTRUCTION_SITES){
                //console.log("CReating COnstructionSite Because: " + this.inProgress.length + " < " + this.MAX_CONSTRUCTION_SITES + " Counter: " + counter);
                const code = this.room.createConstructionSite(entry.x,entry.y,entry.type);
                //console.log("CODE: "+ code);
                if(code == OK){
                    counter += 1;
                    this.inProgress.push(entry);
                }
            } else {
                tempList.push(entry);
            }
        }
        this.leftToBuild=tempList;
    }

    public getPath(origin: RoomPosition ,goal: RoomPosition |
         {pos: RoomPosition, range: number} |
          Array<(RoomPosition | {pos: RoomPosition, range: number})>, opts?: PathFinderOpts | undefined ): PathFinderPath {
        const out = new Array<BuildEntry>();
        const costs = this.getBuildingCostMatrix();
        const path = PathFinder.search(origin, goal, {roomCallback: roomName => {

            const c = costs;
    
            return c;
          }, 
         swampCost: 1, plainCost: 1, maxRooms:1})
         return path;
    }

    public getBuildingCostMatrix(): CostMatrix {
        if(this.buildingCostMatrix == null){
            const costM = new PathFinder.CostMatrix();
            for(const entry of this.basePlan.buildings){
                if(entry.type !== STRUCTURE_ROAD && entry.type !== STRUCTURE_CONTAINER){
                    const newPos= this.transformPos(entry);
                    costM.set(newPos.x,newPos.y, 254);
                }
            }
            this.buildingCostMatrix = costM;
        }
        return this.buildingCostMatrix;
    }

    public updateBuildingCostMatrix(entries: BuildEntry[]): void {
        const matrix = this.getBuildingCostMatrix();
        for( const e of entries){
            if(e.type !== STRUCTURE_ROAD && e.type !== STRUCTURE_CONTAINER){
                const newPos= this.transformPos(e);
                matrix.set(newPos.x,newPos.y, 254);
            }  
        }
        this.buildingCostMatrix = matrix;
    }

    private validateInProgressList(): void {
        const tempList = new Array<BuildEntry>();
        // console.log("Validate inProgress IN: " + JSON.stringify(this.inProgress));
        for(const entry of this.inProgress){
            if(!this.isBuildEntryBuild(entry) && this.isBuildEntryConstructing(entry)){
                tempList.push(entry);
            }
        }

        this.inProgress=tempList;
        // console.log("Validate inProgress OUT: " + JSON.stringify(this.inProgress));
    }
    private isBuildEntryBuild(entry: BuildEntry): boolean {
        if(this.room != null){
            const lookResult = this.room.lookForAt(LOOK_STRUCTURES, entry.x, entry.y);
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

    private isBuildEntryBlocked(entry: BuildEntry): boolean {
        if(this.room != null){
            const lookResult = this.room.lookForAt(LOOK_STRUCTURES, entry.x, entry.y);
            if(lookResult.length > 0){
                for(const r of lookResult){
                    if(r.structureType !== entry.type && r.structureType !== STRUCTURE_ROAD && r.structureType !== STRUCTURE_RAMPART){
                        return true;
                    }
                }
            }
        }
        return false;
    }

    private getBlockingForBuildEntry(entry: BuildEntry): undefined | Structure {
        if(this.room != null){
            const lookResult = this.room.lookForAt(LOOK_STRUCTURES, entry.x, entry.y);
            if(lookResult.length > 0){
                for(const r of lookResult){
                    if(r.structureType !== entry.type && r.structureType !== STRUCTURE_ROAD && r.structureType !== STRUCTURE_RAMPART){
                        return r;
                    }
                }
            }
        }
        return undefined;
    }

    private isBuildEntryConstructing(entry: BuildEntry): boolean {
        if(this.room != null){
            const lookResult = this.room.lookForAt(LOOK_CONSTRUCTION_SITES, entry.x, entry.y);
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
        if(this.room != null){
            console.log("Drawing");
            for(const entry of this.leftToBuild){
                // console.log("Drawing entry. " + JSON.stringify(entry));
                this.room.visual.structure(entry.x, entry.y, entry.type, {opacity: 0.3});
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
        //console.log("Buildig List Test total length: " + completeList.length);
        this.alreadyBuild = new Array<BuildEntry>();
        this.leftToBuild = new Array<BuildEntry>();
        this.blocking = new Array<BuildEntry>();
        if(!this.room){
            return;
        }
        const room: Room = this.room;
        if(!room.controller){
            return;
        }
        if(!room.controller.level){
            return;
        }
        const lvl: number = room.controller.level;
        const structures: Structure[] = room.find(FIND_STRUCTURES);

        for( const type  of Object.keys(CONTROLLER_STRUCTURES)){
            //console.log("Type: " + type);
            const leftToBuild = new Array<BuildEntry>();
            const alreadyBuild: BuildEntry[]= new Array<BuildEntry>();
            // Buildings Blocking the Construction of a Bunker Structure
            const blocking: BuildEntry[] = new Array<BuildEntry>();
            const maxAllowed = CONTROLLER_STRUCTURES[type as BuildableStructureConstant][lvl];
            const buildStructures = structures.filter( str => str.structureType === type);
            const temp = completeList.filter( entry => entry.type === type).slice(0,maxAllowed);
            // Are There Buildings To build for this Type and RCL allows to
            if( !(maxAllowed > 0 && temp.length > 0)){
                continue;
            }
            // Go through  MAX number of Entries for the given type
            for( const entry of temp.slice(0,maxAllowed)){
                const lookResult = room.lookForAt(LOOK_STRUCTURES, entry.x,entry.y);
                if(this.isBuildEntryBuild(entry)){
                    alreadyBuild.push(entry); // If a structure of the type at the pos is found => entry is already built
                }else if(this.isBuildEntryBlocked(entry)){
                    const blocker = this.getBlockingForBuildEntry(entry);
                    if(blocking !== undefined){
                        blocking.push({x: blocker!.pos.x, y: blocker!.pos.y, type: blocker!.structureType as BuildableStructureConstant} );
                    }
                } else {
                    // Found no Structures at the given Postion => Free to add entry to LeftToBuild
                    if(leftToBuild.length < maxAllowed-buildStructures.length){
                        leftToBuild.push(entry);
                    }
                }
            }
            

            this.alreadyBuild = this.alreadyBuild.concat(alreadyBuild);
            this.leftToBuild = this.leftToBuild.concat(leftToBuild);
            this.blocking = this.blocking.concat(blocking);
        }

                

            

        
        //console.log("Updating RoomPlanner Status: " + this.room.name);
        //console.log( " already Build Length: " + this.alreadyBuild.length);
        //console.log("In Progress: " + this.inProgress);
        //console.log(" left2Build length: " + this.leftToBuild.length);
        //console.log(" Blocking length: : " + this.blocking.length);
        //console.log("Sum Check: " + completeList.length +  " VS " + (this.alreadyBuild.length + this.leftToBuild.length  + this.blocking.length ))

    }

    private razeEverythingNotOnList(): void {
        const out: BuildEntry[] = new Array<BuildEntry>();
        const entries = this.generateCompleteList();
        let buildings = this.room.find(FIND_STRUCTURES);
        // Start criteria: Only 1 spawn manually placed remove it from to raze buildings
        if(buildings.filter( build => build.structureType === STRUCTURE_SPAWN).length === 1){
            buildings = buildings.filter( build => build.structureType !== STRUCTURE_SPAWN);
        }
        for(const b of buildings){
            if(!(entries.filter( e => e.x === b.pos.x && e.y === b.pos.y && e.type === b.structureType).length > 0)){
                b.destroy();
            }
        }
    }

    

    public visualize(): void {
        if(this.room != null){
            if(Memory.rooms[this.data.roomName].temp.distanceTransform != null){
                console.log("Drawing Circles over " + Memory.rooms[this.data.roomName].temp.distanceTransform.length + " positions");
                for(const c of Memory.rooms[this.data.roomName].temp.distanceTransform){
                    this.room.visual.circle(c.x,c.y);
                }
            }
        }
    }
}
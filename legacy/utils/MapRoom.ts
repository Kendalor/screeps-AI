import { textSpanContainsPosition } from "typescript";

export class MapRoom {
    public name: string;
    public regex = /([A-Z]+)/;
    public latitude: string;
    public longitude: string;
    public x: number;
    public y: number;
    constructor(name: string){
        const split = name.split(this.regex);
        this.name = name;
        this.latitude = split[1];
        this.longitude = split[3];
        this.x = Number(split[2]);
        this.y = Number(split[4]);
    }



    public isHighway(): boolean {
        if( this.x % 10 === 0 || this.y % 10 === 0){
            return true;
        }
        return false;
    }

    public isIntersection(): boolean {
        if( this.x % 10 === 0 && this.y % 10 === 0){
            return true;
        }
        return false;
    }

    public getRoomType(): ROOM_TYPE{
        if(this.isIntersection()){
            return 'Intersection';
        }else if(this.isHighway()){
            return 'HighwayRoom';
        }else if(this.isKeeperRoom()){
            return 'KeeperRoom';
        } else {
            return 'NormalRoom';
        }
    }

    public isKeeperRoom(): boolean {
        // tslint:disable-next-line:variable-name
        const x_new = this.x % 10;
        // tslint:disable-next-line:variable-name
        const y_new = this.y % 10;
        if(x_new % 10 <= 6 && x_new % 10  >= 4){
            if(y_new % 10 <= 6 && y_new % 10  >= 4){
                return true;
            }
        }
        return false;
    }

    public getRangeTo(room: MapRoom): number{
        if(this.longitude === room.longitude && this.latitude === room.latitude){
            return Math.max(Math.abs(this.x - room.x), Math.abs(this.y -room.y));
        } else if(this.longitude === room.longitude){
            return Math.max(Math.abs(this.x - room.x), Math.abs(this.y + room.y));
        } else if(this.latitude === room.latitude) {
            return Math.max(Math.abs(this.x + room.x), Math.abs(this.y -room.y));
        } else {
            return Math.max(Math.abs(this.x + room.x), Math.abs(this.y +room.y));
        }
    }

    public getRoomsInRange(range: number): string[] {
        const out: string[] = [];
        if(this.x >= range && this.y >= range){
            for(let i=this.x-range; i< this.x+range; i++){
                for(let j=this.y-range; j< this.y+range; j++){
                    out.push(this.latitude+String(i)+this.longitude+String(j));
                }
            }
        }
        return out;
    }

    public getRoomsOfQuadrant(): MapRoom[] {
        console.log("Get Rooms of Quadrant: " + this.name);
        const out: MapRoom[] =[];
        const qX = Math.floor(this.x/10);
        const qY = Math.floor(this.y/10);
        for(let i=0; i<10;i++) {
            for(let j=0; j<10; j++) {
                const temp = new MapRoom(this.latitude+ String(qX) + String(i) + this.longitude + String(qY) + String(j));
                if(!temp.isKeeperRoom()){
                    out.push(temp);
                }
            }
        }
        console.log("Return List of "+ out.length + " Rooms");
        return out;
    }


}
const BUNKER_RADIUS = 6;

export class RoomPlannerUtils {

    public static doTransform(roomName: string): Array<{x: number, y: number}>{
        const out = new Array<{x: number, y: number}>();
        let time = (new Date()).getMilliseconds();
        let cpu = Game.cpu.getUsed();
        const dt = RoomPlannerUtils.distanceTransform(RoomPlannerUtils.walkablePixelsForRoom(roomName)); // a bare Uint8Array
        const cm = new PathFinder.CostMatrix();
        for(const i in dt){
            if(dt[i] > BUNKER_RADIUS) {
                out.push({x: Math.floor(Number(i)/50), y: Number(i)%50})
            }
        }
        

        time = (new Date()).getMilliseconds() - time;
        cpu = Game.cpu.getUsed()-cpu;

        console.log(`dt for ${roomName} took ${time}ms  ${cpu}cpu `);
        return out;
    }

    public static getMostCenterPos(input: Array<{x: number, y: number}>): {x: number, y: number} | null{
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
    private static euclidianDist(a: {x: number, y:number}, b: {x:number, y:number}): number {
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
}
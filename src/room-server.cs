// Greyport LAN lobby for Windows. Built against the in-box .NET Framework.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

public static class GreyportLobby
{
    const int Capacity = 8;
    const int MaxBody = 256 * 1024;
    static readonly object Gate = new object();
    static readonly Dictionary<string, Room> Rooms = new Dictionary<string, Room>(StringComparer.OrdinalIgnoreCase);
    static readonly Dictionary<string, Peer> Tokens = new Dictionary<string, Peer>(StringComparer.Ordinal);
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);
    static readonly Stopwatch Uptime = Stopwatch.StartNew();
    static readonly RandomNumberGenerator Random = RandomNumberGenerator.Create();
    static readonly Regex White = new Regex(@"\s+");
    static string LobbyUrl;
    static byte[] GamePage;
    [ThreadStatic] static JavaScriptSerializer localJson;
    static JavaScriptSerializer Json { get { return localJson ?? (localJson = new JavaScriptSerializer { MaxJsonLength = MaxBody * 3, RecursionLimit = 24 }); } }

    sealed class Problem : Exception {
        internal readonly int Status;
        internal Problem(int status, string text) : base(text) { Status = status; }
    }
    sealed class Room {
        internal string Name, Map;
        internal Peer Host;
        internal readonly List<Peer> Members = new List<Peer>();
    }
    sealed class Frame {
        internal long Serial;
        internal string Text;
    }
    sealed class Peer {
        internal string Id, Token, Name;
        internal Room Room;
        internal int Batch, Connection;
        internal long LastSeen, Serial;
        internal bool Removed;
        internal readonly Queue<Frame> Frames = new Queue<Frame>();
    }
    static string NewId(int size) {
        var bytes = new byte[size];
        Random.GetBytes(bytes);
        return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
    }
    static string Field(Dictionary<string, object> obj, string key) {
        object value;
        return obj.TryGetValue(key, out value) ? value as string : null;
    }
    static string Label(Dictionary<string, object> data, string key, int max) {
        string name = White.Replace((Field(data, key) ?? "").Normalize(NormalizationForm.FormKC).Trim(), " ");
        if (name.Length == 0 || name.Length > max * 5 || new StringInfo(name).LengthInTextElements > max ||
            name.Any(ch => Char.IsControl(ch) || (ch >= '\u202A' && ch <= '\u202E') || (ch >= '\u2066' && ch <= '\u2069')))
            throw new Problem(400, key == "room" ? "房间名须为 1–24 个字符。" : "玩家代号须为 1–16 个字符。");
        return name;
    }
    static object Roster(Room room) {
        return room.Members.Select(p => new { id = p.Id, name = p.Name }).ToArray();
    }
    static void Publish(Peer p, string json) {
        p.Frames.Enqueue(new Frame { Serial = ++p.Serial, Text = json });
        if (p.Frames.Count > 512) p.Frames.Dequeue();
    }
    static void Changed(Room r) {
        string frame = Json.Serialize(new { type = "peers", peers = Roster(r) });
        foreach (Peer p in r.Members) Publish(p, frame);
        Monitor.PulseAll(Gate);
    }
    static void Remove(Peer p) {
        if (p.Removed) return;
        var room = p.Room;
        p.Removed = true;
        Tokens.Remove(p.Token);
        room.Members.Remove(p);
        if (p != room.Host) { Changed(room); return; }
        Rooms.Remove(room.Name);
        string closed = Json.Serialize(new { type = "closed", message = "房主已离开，房间已关闭。" });
        foreach (Peer other in room.Members) {
            Tokens.Remove(other.Token);
            other.Removed = true;
            Publish(other, closed);
        }
        room.Members.Clear();
        Monitor.PulseAll(Gate);
    }
    static Peer Identify(string token) {
        Peer p;
        if (token == null || !Tokens.TryGetValue(token, out p)) throw new Problem(410, "房间已关闭或连接已过期。");
        p.LastSeen = Uptime.ElapsedMilliseconds;
        return p;
    }
    static object Join(string route, Dictionary<string, object> data) {
        string name = Label(data,"name",16), display = Label(data,"room",24);
        bool create = route == "/api/create";
        Room r;
        bool exists = Rooms.TryGetValue(display, out r);
        if (create && exists) throw new Problem(409,"房间名已被使用。可选择该房间加入，或换一个名字。");
        if (!create && !exists) throw new Problem(404,"房间已关闭，请刷新列表。");
        if (create) {
            string map = data.ContainsKey("map") ? Field(data, "map") : "dock";
            if (map != "dock" && map != "rail" && map != "warehouse")
                throw new Problem(400,"请选择有效的地图。");
            r = new Room { Name = display, Map = map };
        }
        if (r.Members.Count >= Capacity) throw new Problem(409,"房间已满，最多 8 名玩家。");
        var p = new Peer {Name=name, Id=NewId(8), Token=NewId(24), Room=r, LastSeen=Uptime.ElapsedMilliseconds};
        if (create) { r.Host=p; Rooms.Add(display,r); }
        Tokens.Add(p.Token,p);
        r.Members.Add(p);
        Changed(r);
        return new {room=r.Name, map=r.Map, id=p.Id, hostId=r.Host.Id, token=p.Token, role=create ? "host" : "join", peers=Roster(r), lanUrl=LobbyUrl};
    }
    static object Action(string route, Dictionary<string,object> data) {
        lock(Gate) {
            if (route == "/api/create" || route == "/api/join") return Join(route,data);
            if (route != "/api/leave" && route != "/api/send") throw new Problem(404,"接口不存在。");
            var p=Identify(Field(data,"token"));
            if (route == "/api/leave") { Remove(p); return new {ok=true}; }
            object rawSeq, rawMessages;
            if (!data.TryGetValue("seq",out rawSeq) || !(rawSeq is int) || !data.TryGetValue("messages",out rawMessages) ||
                !(rawMessages is object[]) || ((object[])rawMessages).Length > 64) throw new Problem(400,"无效的消息批次。");
            int seq=(int)rawSeq;
            if (seq <= p.Batch) return new {ok=true};
            if (seq != p.Batch+1) throw new Problem(409,"消息顺序异常，请重新加入。");
            var staged=new List<KeyValuePair<Peer,string>>();
            foreach (object obj in (object[])rawMessages) {
                var msg=obj as Dictionary<string,object>;
                object payload, to;
                if (msg==null || !msg.TryGetValue("body",out payload) || !(payload is Dictionary<string,object>))
                    throw new Problem(400,"消息格式错误。");
                if (msg.TryGetValue("to",out to) && to!=null && !(to is string)) throw new Problem(400,"接收者格式错误。");
                string target=p == p.Room.Host ? to as string : p.Room.Host.Id;
                string json=Json.Serialize(new {type="game", from=p.Id, body=payload});
                foreach (var other in p.Room.Members)
                    if (other!=p && (String.IsNullOrEmpty(target) || target==other.Id))
                        staged.Add(new KeyValuePair<Peer,string>(other,json));
            }
            foreach (var item in staged) Publish(item.Key,item.Value);
            p.Batch=seq;
            Monitor.PulseAll(Gate);
            return new {ok=true};
        }
    }
    static void Bytes(Stream output, string s) {
        byte[] bytes=Utf8.GetBytes(s);
        output.Write(bytes,0,bytes.Length);
    }
    static string Status(int code) {
        switch(code) {
            case 200:return "OK"; case 400:return "Bad Request"; case 403:return "Forbidden";
            case 404:return "Not Found"; case 409:return "Conflict"; case 410:return "Gone";
            case 413:return "Content Too Large"; default:return "Server Error";
        }
    }
    static void Reply(Stream output,int code,string mime,byte[] bytes) {
        Bytes(output,"HTTP/1.1 "+code+" "+Status(code)+"\r\nContent-Type: "+mime+"\r\nContent-Length: "+bytes.Length+
            "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n");
        output.Write(bytes,0,bytes.Length);
    }
    static void JsonReply(Stream stream,int code,object payload) { Reply(stream,code,"application/json; charset=utf-8",Utf8.GetBytes(Json.Serialize(payload))); }
    static void Events(Stream stream,string token,long after) {
        Peer p;
        int connection;
        lock(Gate) { p=Identify(token); connection=++p.Connection; Monitor.PulseAll(Gate); }
        Bytes(stream,"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\n\r\nretry: 700\n: connected\n\n");
        while(true) {
            var result=new StringBuilder();
            bool closed;
            lock(Gate) {
                long due=Uptime.ElapsedMilliseconds+3000;
                while(!p.Removed && p.Serial<=after && p.Connection==connection && Uptime.ElapsedMilliseconds<due)
                    Monitor.Wait(Gate,(int)Math.Max(1,due-Uptime.ElapsedMilliseconds));
                if (p.Connection!=connection) return;
                bool missed=p.Frames.Count>0 && after < p.Frames.Peek().Serial-1;
                closed=p.Removed || missed;
                if (missed) result.Append("data: {\"type\":\"closed\",\"message\":\"连接中断时间过长，请重新加入。\"}\n\n");
                else foreach (var f in p.Frames) if (f.Serial>after) {
                    result.Append("id: ").Append(f.Serial).Append("\ndata: ").Append(f.Text).Append("\n\n"); after=f.Serial;
                }
            }
            Bytes(stream,result.Length==0 ? ": heartbeat\n\n" : result.ToString());
            if (closed) return;
            lock(Gate) p.LastSeen=Uptime.ElapsedMilliseconds;
        }
    }
    static string Line(Stream input,ref int budget) {
        var b=new StringBuilder();
        while(budget-->0) {
            int ch=input.ReadByte();
            if(ch<0) throw new EndOfStreamException();
            if(ch==10) return b.ToString().TrimEnd('\r');
            b.Append((char)ch);
        }
        throw new Problem(400,"请求头过长。");
    }
    static void Handle(TcpClient client) {
        using(client) {
            client.NoDelay=true;
            client.ReceiveTimeout=7000;
            client.SendTimeout=7000;
            Stream stream=client.GetStream();
            try {
                var input=new BufferedStream(stream,4096);
                int budget=16384;
                string[] start=Line(input,ref budget).Split(' ');
                if(start.Length!=3 || !start[1].StartsWith("/")) throw new Problem(400,"请求格式错误。");
                var headers=new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
                string line;
                while((line=Line(input,ref budget)).Length>0) {
                    int colon=line.IndexOf(':');
                    if(colon<1) throw new Problem(400,"请求头无效。");
                    headers[line.Substring(0,colon)]=line.Substring(colon+1).Trim();
                }
                string target=start[1], verb=start[0];
                int q=target.IndexOf('?');
                string path=q<0 ? target : target.Substring(0,q);
                if(verb=="GET"){
                    if(path=="/api/rooms") {
                        object rooms;
                        lock(Gate) rooms=Rooms.Values.OrderBy(r=>r.Name,StringComparer.OrdinalIgnoreCase)
                            .Select(r=>new {room=r.Name,map=r.Map,count=r.Members.Count,max=Capacity,hostName=r.Host.Name}).ToArray();
                        JsonReply(stream,200,new {rooms,lanUrl=LobbyUrl}); return;
                    }
                    if(path=="/api/events") {
                        string token=q<0 ? null : System.Web.HttpUtility.ParseQueryString(target.Substring(q+1))["token"];
                        long after=0; string last;
                        if(headers.TryGetValue("Last-Event-ID",out last)) Int64.TryParse(last,out after);
                        Events(stream,token,Math.Max(0,after)); return;
                    }
                    if(path=="/" || path=="/index.html" || path=="/pure.html") {
                        Reply(stream,200,"text/html; charset=utf-8",GamePage);return;
                    }
                    throw new Problem(404,"找不到此页面。");
                }
                if(verb!="POST") throw new Problem(400,"不支持此请求。");
                string host,origin;
                if(headers.TryGetValue("Origin",out origin)){
                    Uri uri;
                    if(!Uri.TryCreate(origin,UriKind.Absolute,out uri) || !headers.TryGetValue("Host",out host) ||
                        !String.Equals(uri.Authority,host,StringComparison.OrdinalIgnoreCase))throw new Problem(403,"请在同一大厅页面连接。");
                }
                string sizeText;int size;
                if(!headers.TryGetValue("Content-Length",out sizeText) || !Int32.TryParse(sizeText,out size) || size<1 || size>MaxBody)
                    throw new Problem(413,"消息大小无效。");
                var body=new byte[size];
                for(int pos=0;pos<body.Length;){
                    int n=input.Read(body,pos,body.Length-pos);if(n==0)throw new EndOfStreamException();pos+=n;
                }
                var data=Json.DeserializeObject(Utf8.GetString(body)) as Dictionary<string,object>;
                if(data==null)throw new Problem(400,"消息格式无效。");
                JsonReply(stream,200,Action(path,data));
            } catch(Problem p) { TryError(stream,p.Status,p.Message); }
              catch(ArgumentException) { TryError(stream,400,"名称或数据格式无效。"); }
              catch(InvalidOperationException) { TryError(stream,400,"数据格式无效。"); }
              catch(IOException) { /* the player may have closed the tab */ }
              catch(SocketException) { /* the connection was reset */ }
              catch(Exception) { TryError(stream,500,"大厅暂时无法处理请求。"); }
        }
    }
    static void TryError(Stream stream,int code,string msg) { try { JsonReply(stream,code,new {error=msg}); } catch(IOException){} catch(SocketException){} }
    static IEnumerable<string> Addresses() {
        return NetworkInterface.GetAllNetworkInterfaces()
            .Where(n=>n.OperationalStatus==OperationalStatus.Up && n.NetworkInterfaceType!=NetworkInterfaceType.Loopback)
            .Select(n=>n.GetIPProperties()).OrderByDescending(p=>p.GatewayAddresses.Count>0)
            .SelectMany(p=>p.UnicastAddresses).Select(a=>a.Address)
            .Where(a=>a.AddressFamily==AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)).Select(a=>a.ToString()).Distinct();
    }
    static byte[] LoadGame(string path) {
        if(path!=null){
            byte[] file=File.ReadAllBytes(path);
            if(file.Length>32 && Utf8.GetString(file,0,32).TrimStart('\ufeff').StartsWith("<!DOCTYPE html>",StringComparison.OrdinalIgnoreCase))return file;
            Console.WriteLine("外部文件无法识别为 HTML，使用内置游戏。");
        }
        using(var resource=Assembly.GetExecutingAssembly().GetManifestResourceStream("Greyport.Game.gz")){
            if(resource==null)throw new InvalidDataException("大厅缺少内置游戏资源。");
            using(var zip=new GZipStream(resource,CompressionMode.Decompress))
            using(var result=new MemoryStream()){
                zip.CopyTo(result);return result.ToArray();
            }
        }
    }
    sealed class Listener : IDisposable {
        readonly TcpListener server;
        readonly Timer timer;
        readonly Thread loop;
        volatile bool closed;

        internal Listener(byte[] page, IPAddress bind, int port, bool explicitPort, bool browse) {
            if(port<1 || port>65535)throw new ArgumentException("端口无效。");
            string[] addresses=bind.Equals(IPAddress.Any)?Addresses().ToArray():new[]{bind.ToString()};
            if(addresses.Length==0)addresses=new[]{"127.0.0.1"};
            int max=explicitPort?port:Math.Min(port+15,65535);
            for(;port<=max;port++){
                try { server=new TcpListener(bind,port);server.Start(64);break; }
                catch(SocketException){ if(port==max)throw; }
            }
            GamePage=page;
            LobbyUrl="http://"+addresses[0]+":"+port;
            Console.WriteLine("灰港战线 · 局域网大厅\n");
            foreach(string address in addresses)Console.WriteLine("大厅地址  http://"+address+":"+port+"/");
            Console.WriteLine("\n所有玩家打开同一个大厅地址，即可创建房间或从列表加入。\n保持本窗口开启。");
            ThreadPool.SetMinThreads(64,16);
            timer=new Timer(delegate{
                lock(Gate) foreach(var p in Tokens.Values.Where(p=>Uptime.ElapsedMilliseconds-p.LastSeen>24000).ToArray())Remove(p);
            },null,4000,4000);
            loop=new Thread(Accept){IsBackground=true};loop.Start();
            if(browse)try{Process.Start(new ProcessStartInfo(bind.Equals(IPAddress.Any)?"http://127.0.0.1:"+port+"/":LobbyUrl+"/"){UseShellExecute=true});}catch(Exception){}
        }
        void Accept() {
            while(!closed){
                try { var client=server.AcceptTcpClient();ThreadPool.QueueUserWorkItem(_=>Handle(client)); }
                catch(SocketException) { if(!closed) Thread.Sleep(100); }
                catch(ObjectDisposedException) { break; }
            }
        }
        internal void Wait() { loop.Join(); }
        public void Dispose() {
            if(closed)return;
            closed=true;server.Stop();loop.Join();timer.Dispose();
            lock(Gate){
                foreach(var peer in Tokens.Values.ToArray()) Remove(peer);
            }
        }
    }
    // The HTML supplies its own UTF-8 page to the in-box Windows PowerShell host.
    public static IDisposable OpenPage(string html, string address, int port, bool browse) {
        if(String.IsNullOrEmpty(html) || !html.StartsWith("<!DOCTYPE html>",StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("请选择完整的游戏 HTML 文件。");
        return new Listener(Utf8.GetBytes(html),IPAddress.Parse(address),port,false,browse);
    }
    static int Main(string[] args) {
        Console.OutputEncoding=Utf8;
        try {
            int port=8787; bool browse=true,explicitPort=false; IPAddress bind=IPAddress.Any;
            string gamePath=null;
            for(int i=0;i<args.Length;i++) {
                switch(args[i]) {
                    case "--port":port=Int32.Parse(args[++i]);explicitPort=true;break;
                    case "--bind":bind=IPAddress.Parse(args[++i]);break;
                    case "--html":gamePath=Path.GetFullPath(args[++i]);break;
                    case "--no-browser":browse=false;break;
                    default:throw new ArgumentException("未知参数："+args[i]);
                }
            }
            using (var service = new Listener(LoadGame(gamePath),bind,port,explicitPort,browse))service.Wait();
            return 0;
        } catch(Exception ex) {
            Console.Error.WriteLine(ex.Message);
            if(args.Length==0 && Environment.UserInteractive){Console.WriteLine("按回车键退出。");Console.ReadLine();}
            return 1;
        }
    }
}

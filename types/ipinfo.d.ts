declare module 'ipinfo' {
  interface IpInfoOptions {
    token?: string;
    timeout?: number;
  }

  interface IpInfoResponse {
    ip: string;
    hostname?: string;
    city?: string;
    region?: string;
    country?: string;
    loc?: string;
    org?: string;
    postal?: string;
    timezone?: string;
    [key: string]: any;
  }

  function ipinfo(ip?: string, options?: IpInfoOptions): Promise<IpInfoResponse>;

  export = ipinfo;
}

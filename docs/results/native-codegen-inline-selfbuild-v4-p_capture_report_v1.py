import json,struct,os,lldb,time
output=os.environ['TINT_P_REPORT_CAPTURE']
def capture(frame,location,internal):
    process=frame.GetThread().GetProcess()
    address=frame.FindRegister('x4').GetValueAsUnsigned()
    error=lldb.SBError()
    header=process.ReadMemory(address,24,error)
    result={'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'address':address}
    if error.Success() and len(header)==24:
        length=struct.unpack_from('<I',header,16)[0]
        if length<1048576:
            payload=process.ReadMemory(address+24,length*2,error)
            result['message']=payload.decode('utf-16le',errors='replace') if error.Success() else str(error)
        else:result['invalidLength']=length
    else:result['error']=str(error)
    with open(output,'a') as stream:stream.write(json.dumps(result)+'\n')
    print('native report: '+json.dumps(result),flush=True)
    return False

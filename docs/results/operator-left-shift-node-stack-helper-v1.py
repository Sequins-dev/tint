import lldb, json, time
p=lldb.debugger.GetSelectedTarget().GetProcess()
try:
    assert p.GetProcessID()==12529 and p.GetState()==lldb.eStateStopped
    t=p.GetTarget()
    def address(name):
        matches=t.FindSymbols(name)
        for i in range(matches.GetSize()):
            s=matches.GetContextAtIndex(i).GetSymbol()
            a=s.GetStartAddress().GetLoadAddress(t)
            if a!=lldb.LLDB_INVALID_ADDRESS:return a
        raise RuntimeError('symbol unavailable: '+name)
    current=address('_ZN2v87Isolate10GetCurrentEv')
    printer=address('_ZN2v87Message22PrintCurrentStackTraceEPNS_7IsolateERNSt3__113basic_ostreamIcNS3_11char_traitsIcEEEEPFbS2_NS_5LocalINS_6StringEEEE')
    stderr=address('_ZNSt3__14cerrE')
    thread=p.GetThreadAtIndex(0); p.SetSelectedThread(thread)
    options=lldb.SBExpressionOptions()
    options.SetLanguage(lldb.eLanguageTypeC_plus_plus)
    options.SetTimeoutInMicroSeconds(2000000)
    options.SetUnwindOnError(True)
    options.SetIgnoreBreakpoints(True)
    options.SetTryAllThreads(False)
    options.SetStopOthers(True)
    expression='((void(*)(void*,void*,void*))%d)(((void*(*)())%d)(),(void*)%d,(void*)0)'%(printer,current,stderr)
    print('V8 stack request',json.dumps({'pid':p.GetProcessID(),'thread':thread.GetIndexID(),'time':time.time()}))
    result=thread.GetFrameAtIndex(0).EvaluateExpression(expression,options)
    print('V8 stack result',str(result.GetError()))
except Exception as error:
    print('V8 stack diagnostic error',str(error))
finally:
    print('detach',str(p.Detach()))
